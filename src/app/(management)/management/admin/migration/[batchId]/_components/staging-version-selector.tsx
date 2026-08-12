"use client";

/**
 * WP-08-01F R2 — Staging version selector.
 *
 * Lets the authorized user select between:
 *   - current version (default — shows only is_current=true rows)
 *   - historical superseded version (read-only, visually marked as superseded)
 *
 * Never mixes rows/findings from different versions — the selection is passed
 * as a query param `fileVersion` to the server, which filters staging rows
 * and findings by the selected file version.
 *
 * Historical versions are read-only and visually marked as superseded.
 */
import * as React from "react";
import { LtrValue } from "@/components/ui/ltr-value";

interface StagingVersionSelectorProps {
  /** All file versions for the batch (current + superseded). */
  files: Array<{
    id: string;
    originalFileName: string;
    fileVersion: number;
    isCurrent: boolean;
    fileHashRedacted: string;
    createdAt: string;
    supersededReason: string | null;
  }>;
  /** Currently selected file ID (null = current version). */
  selectedFileId: string | null;
  /** Current pathname for building URLs. */
  pathname: string;
  /** Query params to preserve across version switches. */
  preserveParams: Record<string, string | undefined>;
}

function buildVersionUrl(
  pathname: string,
  preserveParams: Record<string, string | undefined>,
  fileId: string | null,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(preserveParams)) {
    if (value !== undefined && value !== "") {
      params.set(key, value);
    }
  }
  if (fileId) {
    params.set("fileVersion", fileId);
  } else {
    params.delete("fileVersion");
  }
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export function StagingVersionSelector({
  files,
  selectedFileId,
  pathname,
  preserveParams,
}: StagingVersionSelectorProps) {
  if (files.length <= 1) {
    // Only one version — no selector needed.
    return null;
  }

  return (
    <div className="border rounded p-3 space-y-2">
      <div className="text-xs font-semibold text-foreground">
        عرض نسخة الملف:
      </div>
      <div className="flex flex-wrap gap-2">
        {/* Current version option */}
        <a
          href={buildVersionUrl(pathname, preserveParams, null)}
          className={`px-3 py-2 border rounded text-xs inline-flex items-center gap-2 ${
            !selectedFileId
              ? "border-primary bg-primary/5 text-primary font-semibold"
              : "border-muted text-muted-foreground hover:bg-muted/30"
          }`}
          style={{ minHeight: "44px" }}
          aria-label="عرض النسخة الحالية"
          aria-current={!selectedFileId ? "true" : undefined}
        >
          <span aria-hidden="true">✓</span>
          النسخة الحالية
        </a>
        {/* Historical versions */}
        {files.filter((f) => !f.isCurrent).map((f) => (
          <a
            key={f.id}
            href={buildVersionUrl(pathname, preserveParams, f.id)}
            className={`px-3 py-2 border rounded text-xs inline-flex items-center gap-2 ${
              selectedFileId === f.id
                ? "border-amber-500 bg-amber-50 text-amber-700 font-semibold"
                : "border-muted text-muted-foreground hover:bg-muted/30"
            }`}
            style={{ minHeight: "44px" }}
            aria-label={`عرض النسخة الملغاة v${f.fileVersion}`}
            aria-current={selectedFileId === f.id ? "true" : undefined}
          >
            <span aria-hidden="true">↩</span>
            <span>نسخة ملغاة</span>
            <LtrValue>v{f.fileVersion}</LtrValue>
            <span className="text-muted-foreground">(<LtrValue>{f.originalFileName}</LtrValue>)</span>
          </a>
        ))}
      </div>
      {selectedFileId && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-500/50 rounded p-2">
          ⚠ أنت تعرض نسخة ملغاة (للقراءة فقط). هذه البيانات لا تُستخدم في التحقق أو المطابقة أو الاعتماد الحالي.
        </div>
      )}
    </div>
  );
}
