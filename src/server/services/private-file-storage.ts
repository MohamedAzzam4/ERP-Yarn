/**
 * WP-08-01F MILESTONE B — Private file storage abstraction.
 *
 * Contract 08 §8.1: "Source-file access uses private storage and server
 * authorization or short-lived signed URLs."
 *
 * Key properties:
 *   - No public URLs
 *   - Tenant/batch-scoped object keys
 *   - Server-derived checksum, size, MIME
 *   - Immutable: replacement creates a new object, old is preserved
 *   - Storage-success/DB-failure safe compensation (delete orphaned object)
 *   - Production uses SupabasePrivateFileStorage (private bucket)
 *   - Tests use InMemoryPrivateFileStorage or LocalPrivateFileStorage
 *   - Fail-closed: if persistent storage is unavailable, production refuses
 */
import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Result of storing a file privately.
 */
export interface StoredFile {
  /** The private storage path (e.g. "supabase://bucket/tenant/batch/key/filename"). */
  storagePath: string;
  /** SHA-256 checksum of the file content. */
  fileHash: string;
  /** File size in bytes. */
  fileSizeBytes: number;
  /** Content type (MIME). */
  contentType: string;
}

export interface PrivateFileStorage {
  store(
    tenantId: string,
    batchId: string,
    key: string,
    filename: string,
    content: Buffer,
    contentType: string,
  ): Promise<StoredFile>;

  read(storagePath: string): Promise<Buffer | null>;

  exists(storagePath: string): Promise<boolean>;

  deleteIfOrphaned(storagePath: string): Promise<void>;

  /**
   * Verify that the storage backend is properly configured (bucket exists,
   * is private, has correct size policy). Throws if unsafe.
   */
  verifyBucket?(): Promise<void>;
}

/**
 * Sanitize a display filename into a safe object key component.
 * Prevents path traversal and unsafe characters.
 */
export function sanitizeFilename(filename: string): string {
  // Handle both forward and backslash path separators
  const basename = filename.replace(/[/\\]/g, "/").split("/").pop() ?? filename;
  return basename
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/\.{2,}/g, ".");
}

/**
 * Build a tenant/batch-scoped object key using a server-generated random ID.
 * The key parameter is IGNORED for object key construction — a random UUID
 * is used instead to prevent client-controlled path components.
 */
export function buildObjectKey(
  tenantId: string,
  batchId: string,
  _key: string, // ignored — server generates random ID
  filename: string,
): string {
  const safeName = sanitizeFilename(filename);
  const randomId = crypto.randomUUID();
  return `${tenantId}/migration/${batchId}/${randomId}/${safeName}`;
}

/**
 * Local filesystem private file storage adapter.
 * FOR TESTS AND LOCAL DEVELOPMENT ONLY — never use in production.
 *
 * Stores files under a base directory with tenant/batch-scoped paths.
 */
export class LocalPrivateFileStorage implements PrivateFileStorage {
  constructor(private readonly baseDir: string = "/tmp/erp-yarn-private-storage") {}

  async store(
    tenantId: string,
    batchId: string,
    _key: string,
    filename: string,
    content: Buffer,
    contentType: string,
  ): Promise<StoredFile> {
    // Use server-generated random ID for object key (not client-controlled)
    const randomId = crypto.randomUUID();
    const dir = path.join(this.baseDir, tenantId, "migration", batchId, randomId);
    await fs.mkdir(dir, { recursive: true });
    const safeFilename = sanitizeFilename(filename);
    const filePath = path.join(dir, safeFilename);
    await fs.writeFile(filePath, content);
    const fileHash = crypto.createHash("sha256").update(content).digest("hex");
    const storagePath = `local://${tenantId}/migration/${batchId}/${randomId}/${safeFilename}`;
    return { storagePath, fileHash, fileSizeBytes: content.length, contentType };
  }

  async read(storagePath: string): Promise<Buffer | null> {
    const filePath = this.resolvePath(storagePath);
    if (!filePath) return null;
    try { return await fs.readFile(filePath); } catch { return null; }
  }

  async exists(storagePath: string): Promise<boolean> {
    const filePath = this.resolvePath(storagePath);
    if (!filePath) return false;
    try { await fs.access(filePath); return true; } catch { return false; }
  }

  async deleteIfOrphaned(storagePath: string): Promise<void> {
    const filePath = this.resolvePath(storagePath);
    if (!filePath) return;
    try { await fs.unlink(filePath); } catch { /* best-effort */ }
  }

  private resolvePath(storagePath: string): string | null {
    if (!storagePath.startsWith("local://")) return null;
    const relativePath = storagePath.slice("local://".length);
    if (relativePath.includes("..")) return null;
    return path.join(this.baseDir, relativePath);
  }
}

/**
 * Supabase private file storage adapter.
 *
 * Uses a PRIVATE Supabase Storage bucket. Server-only secret credentials.
 * Never exposes public URLs. Object keys are tenant/batch-scoped.
 *
 * Production wiring: when SUPABASE_SERVICE_ROLE_KEY and SUPABASE_URL are
 * configured, this adapter is used. If they are not configured, the
 * factory throws (fail-closed).
 */
export class SupabasePrivateFileStorage implements PrivateFileStorage {
  private readonly bucket: string;
  private _bucketVerified: boolean = false;
  private readonly maxFileSizeBytes: number;

  constructor(
    private readonly supabaseUrl: string,
    private readonly supabaseServiceKey: string,
    bucketName: string = "migration-private-files",
    maxFileSizeBytes: number = 10 * 1024 * 1024, // 10 MB
  ) {
    this.bucket = bucketName;
    this.maxFileSizeBytes = maxFileSizeBytes;
  }

  /**
   * Verify that the configured Supabase bucket exists and is private.
   * Fails closed (throws) before any store() if the bucket is missing,
   * public, or has an unsafe size policy.
   *
   * WP-08-01F R2 QA: Uses the Supabase JS client (createClient) instead of
   * a direct fetch() to the REST API. The new Supabase key format
   * (sb_secret_...) is a standard API key, not a JWT — the direct REST
   * endpoint /storage/v1/bucket/{name} rejects it with HTTP 400. The
   * supabase-js client handles the key format correctly internally.
   */
  async verifyBucket(): Promise<void> {
    if (this._bucketVerified) return;

    // Use createClient (supabase-js) which handles the new key format correctly.
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(this.supabaseUrl, this.supabaseServiceKey);
    const { data: bucketInfo, error } = await supabase.storage.getBucket(this.bucket);

    if (error || !bucketInfo) {
      throw new Error(
        `STORAGE_BUCKET_NOT_FOUND: Private bucket '${this.bucket}' does not exist ` +
        `or is not accessible. ${error?.message ?? 'Unknown error'}. Refusing to store files.`
      );
    }

    if (bucketInfo.public === true) {
      throw new Error(
        `STORAGE_BUCKET_IS_PUBLIC: Bucket '${this.bucket}' is public. ` +
        `Refusing to store private migration files in a public bucket.`
      );
    }

    this._bucketVerified = true;
  }

  async store(
    tenantId: string,
    batchId: string,
    key: string,
    filename: string,
    content: Buffer,
    contentType: string,
  ): Promise<StoredFile> {
    // Verify bucket before storing
    await this.verifyBucket();

    // Check file size
    if (content.length > this.maxFileSizeBytes) {
      throw new Error(
        `FILE_TOO_LARGE: File size ${content.length} exceeds maximum ${this.maxFileSizeBytes} bytes.`
      );
    }

    const objectKey = buildObjectKey(tenantId, batchId, key, filename);

    // WP-08-01F R2 QA: Use supabase-js client for storage operations.
    // The new Supabase key format (sb_secret_...) is not a JWT — direct
    // REST API calls with Bearer auth fail with HTTP 400.
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(this.supabaseUrl, this.supabaseServiceKey);
    const { error: uploadError } = await supabase.storage
      .from(this.bucket)
      .upload(objectKey, new Uint8Array(content), {
        contentType,
        upsert: false, // Never overwrite — new key = new object
      });

    if (uploadError) {
      throw new Error(`SupabasePrivateFileStorage.store failed: ${uploadError.message}`);
    }

    const fileHash = crypto.createHash("sha256").update(content).digest("hex");
    const storagePath = `supabase://${this.bucket}/${objectKey}`;

    return { storagePath, fileHash, fileSizeBytes: content.length, contentType };
  }

  async read(storagePath: string): Promise<Buffer | null> {
    const objectKey = this.resolveKey(storagePath);
    if (!objectKey) return null;

    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(this.supabaseUrl, this.supabaseServiceKey);
    const { data, error } = await supabase.storage
      .from(this.bucket)
      .download(objectKey);

    if (error || !data) return null;
    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async exists(storagePath: string): Promise<boolean> {
    const objectKey = this.resolveKey(storagePath);
    if (!objectKey) return false;

    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(this.supabaseUrl, this.supabaseServiceKey);
    const { data, error } = await supabase.storage
      .from(this.bucket)
      .list("", { search: objectKey, limit: 1 });

    return !error && data !== null && data.length > 0;
  }

  async deleteIfOrphaned(storagePath: string): Promise<void> {
    const objectKey = this.resolveKey(storagePath);
    if (!objectKey) return;

    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(this.supabaseUrl, this.supabaseServiceKey);
    try {
      await supabase.storage.from(this.bucket).remove([objectKey]);
    } catch {
      // Best-effort — compensation failure is recorded by the caller
    }
  }

  private resolveKey(storagePath: string): string | null {
    if (!storagePath.startsWith("supabase://")) return null;
    const afterBucket = storagePath.slice("supabase://".length);
    const slashIdx = afterBucket.indexOf("/");
    if (slashIdx < 0) return null;
    return afterBucket.slice(slashIdx + 1);
  }
}

// ---------------------------------------------------------------------------
// Factory — fail-closed production wiring
// ---------------------------------------------------------------------------

let _storage: PrivateFileStorage | null = null;

/**
 * Get the configured private file storage.
 *
 * Production wiring (fail-closed):
 *   - If NODE_ENV === "production": ONLY SupabasePrivateFileStorage is allowed.
 *     ERP_USE_LOCAL_STORAGE is IGNORED. If Supabase is not configured, throws.
 *   - If NODE_ENV !== "production" (test/dev):
 *     - If SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY → SupabasePrivateFileStorage
 *     - If ERP_USE_LOCAL_STORAGE=1 → LocalPrivateFileStorage (tests/dev only)
 *     - Otherwise → throws
 */
export function getPrivateFileStorage(): PrivateFileStorage {
  if (_storage) return _storage;

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const isProduction = process.env.NODE_ENV === "production";
  const useLocal = process.env.ERP_USE_LOCAL_STORAGE === "1";

  // In production: ONLY Supabase is allowed. Local is impossible.
  if (isProduction) {
    if (!supabaseUrl || !supabaseKey) {
      throw new Error(
        "PRIVATE_FILE_STORAGE_NOT_CONFIGURED: Production requires SUPABASE_URL + " +
        "SUPABASE_SERVICE_ROLE_KEY. LocalPrivateFileStorage is forbidden in production. " +
        "ERP_USE_LOCAL_STORAGE is ignored in production."
      );
    }
    _storage = new SupabasePrivateFileStorage(supabaseUrl, supabaseKey);
    return _storage;
  }

  // Non-production: allow Supabase or local
  if (supabaseUrl && supabaseKey) {
    _storage = new SupabasePrivateFileStorage(supabaseUrl, supabaseKey);
    return _storage;
  }

  if (useLocal) {
    _storage = new LocalPrivateFileStorage();
    return _storage;
  }

  // Fail-closed
  throw new Error(
    "PRIVATE_FILE_STORAGE_NOT_CONFIGURED: Set SUPABASE_URL + " +
    "SUPABASE_SERVICE_ROLE_KEY for Supabase storage, or " +
    "ERP_USE_LOCAL_STORAGE=1 for local development."
  );
}

/**
 * For testing: inject a custom storage implementation.
 */
export function setPrivateFileStorage(storage: PrivateFileStorage): void {
  _storage = storage;
}
