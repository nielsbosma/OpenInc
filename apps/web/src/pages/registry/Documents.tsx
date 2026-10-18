import { TX_DOCUMENT_KINDS } from '@openinc/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTRPC } from '@/lib/trpc';
import { uploadFile } from '@/lib/upload';

export type DocumentKind = (typeof TX_DOCUMENT_KINDS)[number];

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  decision: 'Board or General Meeting Decision',
  minutes: 'Minutes',
  subscription_list: 'Subscription List',
  payment_proof: 'Proof of Payment',
  registration_certificate: 'Registration Certificate',
  agreement: 'Agreement',
  consent: 'Consent or Waiver',
  other: 'Other',
};

export interface DocumentRow {
  id: string;
  name: string;
  kind: string;
  sha256: string;
  url?: string;
  fileId?: string;
}

/** Evidence on a transaction: uploaded files only, each with its SHA-256. */
export function Documents({
  transactionId,
  documents,
  editable,
  canAttach,
}: {
  transactionId: string;
  documents: DocumentRow[];
  editable: boolean;
  canAttach: boolean;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<DocumentKind>('decision');
  const [busy, setBusy] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.registry.pathKey() });
  const attach = useMutation(trpc.registry.attachDocument.mutationOptions({ onSuccess: refresh }));
  const detach = useMutation(trpc.registry.detachDocument.mutationOptions({ onSuccess: refresh }));

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        const uploaded = await uploadFile(file, 'registry-document');
        await attach.mutateAsync({ transactionId, fileId: uploaded.id, kind });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="grid gap-3">
      {documents.length === 0 ? (
        <p className="text-muted-foreground">No documents attached.</p>
      ) : (
        <ul className="grid gap-2">
          {documents.map((d) => (
            <li key={d.id} className="flex items-center gap-3 rounded-md border px-3 py-2">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                {d.url ? (
                  <a href={d.url} target="_blank" rel="noreferrer" className="truncate font-medium hover:underline">
                    {d.name}
                  </a>
                ) : (
                  <span className="truncate font-medium">{d.name}</span>
                )}
                <div className="truncate text-xs text-muted-foreground">
                  {DOCUMENT_KIND_LABELS[d.kind as DocumentKind] ?? d.kind} ·{' '}
                  <span className="font-mono">sha256 {d.sha256.slice(0, 16)}…</span>
                </div>
              </div>
              {editable && (
                <Button variant="ghost" size="sm" onClick={() => detach.mutate({ documentId: d.id })}>
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canAttach && (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={kind} onValueChange={(v) => setKind(v as DocumentKind)}>
            <SelectTrigger className="w-64" aria-label="Document Kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TX_DOCUMENT_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {DOCUMENT_KIND_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" disabled={busy} onClick={() => input.current?.click()}>
            <Upload /> {busy ? 'Uploading…' : 'Attach Document'}
          </Button>
          <input ref={input} type="file" multiple hidden onChange={(e) => onFiles(e.target.files)} />
        </div>
      )}
    </div>
  );
}
