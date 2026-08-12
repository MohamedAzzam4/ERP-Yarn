/**
 * WP-08-01F MILESTONE B — In-memory private file storage for tests.
 */
import type { PrivateFileStorage, StoredFile } from "../private-file-storage";
import { sanitizeFilename } from "../private-file-storage";
import crypto from "node:crypto";

export class InMemoryPrivateFileStorage implements PrivateFileStorage {
  private files = new Map<string, Buffer>();

  async store(
    tenantId: string,
    batchId: string,
    _key: string,
    filename: string,
    content: Buffer,
    contentType: string,
  ): Promise<StoredFile> {
    // Use server-generated random ID (same as production adapters)
    const randomId = crypto.randomUUID();
    const safeFilename = sanitizeFilename(filename);
    const storagePath = `inmemory://${tenantId}/migration/${batchId}/${randomId}/${safeFilename}`;
    this.files.set(storagePath, content);
    const fileHash = crypto.createHash("sha256").update(content).digest("hex");
    return {
      storagePath,
      fileHash,
      fileSizeBytes: content.length,
      contentType,
    };
  }

  async read(storagePath: string): Promise<Buffer | null> {
    return this.files.get(storagePath) ?? null;
  }

  async exists(storagePath: string): Promise<boolean> {
    return this.files.has(storagePath);
  }

  async deleteIfOrphaned(storagePath: string): Promise<void> {
    this.files.delete(storagePath);
  }

  /** Test helper: get the number of stored files. */
  getFileCount(): number {
    return this.files.size;
  }

  /** Test helper: check if a specific file exists. */
  hasFile(storagePath: string): boolean {
    return this.files.has(storagePath);
  }
}
