/**
 * WP-08-01F MILESTONE B — In-memory private file storage for tests.
 */
import type { PrivateFileStorage, StoredFile } from "../private-file-storage";
import crypto from "node:crypto";

export class InMemoryPrivateFileStorage implements PrivateFileStorage {
  private files = new Map<string, Buffer>();

  async store(
    tenantId: string,
    batchId: string,
    key: string,
    filename: string,
    content: Buffer,
    contentType: string,
  ): Promise<StoredFile> {
    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `private://${tenantId}/migration/${batchId}/${key}/${safeFilename}`;
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
