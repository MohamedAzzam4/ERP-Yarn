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
 * Build a tenant/batch-scoped object key.
 */
export function buildObjectKey(
  tenantId: string,
  batchId: string,
  key: string,
  filename: string,
): string {
  const safeName = sanitizeFilename(filename);
  return `${tenantId}/migration/${batchId}/${key}/${safeName}`;
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
    key: string,
    filename: string,
    content: Buffer,
    contentType: string,
  ): Promise<StoredFile> {
    const dir = path.join(this.baseDir, tenantId, "migration", batchId, key);
    await fs.mkdir(dir, { recursive: true });
    const safeFilename = sanitizeFilename(filename);
    const filePath = path.join(dir, safeFilename);
    await fs.writeFile(filePath, content);
    const fileHash = crypto.createHash("sha256").update(content).digest("hex");
    const storagePath = `local://${tenantId}/migration/${batchId}/${key}/${safeFilename}`;
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

  constructor(
    private readonly supabaseUrl: string,
    private readonly supabaseServiceKey: string,
    bucketName: string = "migration-private-files",
  ) {
    this.bucket = bucketName;
  }

  async store(
    tenantId: string,
    batchId: string,
    key: string,
    filename: string,
    content: Buffer,
    contentType: string,
  ): Promise<StoredFile> {
    const objectKey = buildObjectKey(tenantId, batchId, key, filename);

    // Upload to private bucket using server-side fetch
    const uploadUrl = `${this.supabaseUrl}/storage/v1/object/${this.bucket}/${objectKey}`;
    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.supabaseServiceKey}`,
        "Content-Type": contentType,
        "x-upsert": "false", // Never overwrite — new key = new object
      },
      body: new Uint8Array(content),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown error");
      throw new Error(`SupabasePrivateFileStorage.store failed: ${response.status} ${errorText}`);
    }

    const fileHash = crypto.createHash("sha256").update(content).digest("hex");
    const storagePath = `supabase://${this.bucket}/${objectKey}`;

    return { storagePath, fileHash, fileSizeBytes: content.length, contentType };
  }

  async read(storagePath: string): Promise<Buffer | null> {
    const objectKey = this.resolveKey(storagePath);
    if (!objectKey) return null;

    const downloadUrl = `${this.supabaseUrl}/storage/v1/object/${this.bucket}/${objectKey}`;
    const response = await fetch(downloadUrl, {
      headers: { "Authorization": `Bearer ${this.supabaseServiceKey}` },
    });

    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async exists(storagePath: string): Promise<boolean> {
    const objectKey = this.resolveKey(storagePath);
    if (!objectKey) return false;

    const checkUrl = `${this.supabaseUrl}/storage/v1/object/${this.bucket}/${objectKey}`;
    const response = await fetch(checkUrl, {
      method: "HEAD",
      headers: { "Authorization": `Bearer ${this.supabaseServiceKey}` },
    });

    return response.ok;
  }

  async deleteIfOrphaned(storagePath: string): Promise<void> {
    const objectKey = this.resolveKey(storagePath);
    if (!objectKey) return;

    const deleteUrl = `${this.supabaseUrl}/storage/v1/object/${this.bucket}/${objectKey}`;
    try {
      await fetch(deleteUrl, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${this.supabaseServiceKey}` },
      });
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
 * Production wiring:
 *   - If SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set → SupabasePrivateFileStorage
 *   - If ERP_USE_LOCAL_STORAGE=1 → LocalPrivateFileStorage (tests/dev only)
 *   - Otherwise → throws (fail-closed: no persistent storage available)
 */
export function getPrivateFileStorage(): PrivateFileStorage {
  if (_storage) return _storage;

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const useLocal = process.env.ERP_USE_LOCAL_STORAGE === "1";

  if (supabaseUrl && supabaseKey) {
    _storage = new SupabasePrivateFileStorage(supabaseUrl, supabaseKey);
    return _storage;
  }

  if (useLocal) {
    _storage = new LocalPrivateFileStorage();
    return _storage;
  }

  // Fail-closed: no persistent storage configured
  throw new Error(
    "PRIVATE_FILE_STORAGE_NOT_CONFIGURED: Production requires SUPABASE_URL + " +
    "SUPABASE_SERVICE_ROLE_KEY for SupabasePrivateFileStorage, or " +
    "ERP_USE_LOCAL_STORAGE=1 for local development. Refusing to use " +
    "ephemeral filesystem as production storage."
  );
}

/**
 * For testing: inject a custom storage implementation.
 */
export function setPrivateFileStorage(storage: PrivateFileStorage): void {
  _storage = storage;
}
