import type { FileKind } from '@openinc/shared';

export interface UploadedFile {
  id: string;
  kind: FileKind;
  name: string;
  contentType: string;
  sizeBytes: number;
  url: string;
  previewable: boolean;
}

/** Sends the file as the raw request body (see apps/server/src/web/files.ts). */
export async function uploadFile(
  file: File | Blob,
  kind: FileKind,
  name = file instanceof File ? file.name : 'pasted-image.png',
): Promise<UploadedFile> {
  const res = await fetch(`/api/files?kind=${kind}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(name) },
    body: file,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Upload failed (${res.status})`);
  return body as UploadedFile;
}
