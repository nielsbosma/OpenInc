import { useMutation, useQuery } from '@tanstack/react-query';
import { FileSpreadsheet, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { EmptyState } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useClientConfig, useFormat } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { uploadFile } from '@/lib/upload';

export const IMPORT_STATUS_LABELS: Record<string, string> = {
  extracting: 'Reading',
  review: 'Ready for Review',
  committed: 'Drafts Created',
  failed: 'Failed',
  discarded: 'Discarded',
};

export function ImportTab() {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const format = useFormat();
  const config = useClientConfig();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const imports = useQuery(trpc.registry.listImports.queryOptions());
  const start = useMutation(trpc.registry.startImport.mutationOptions({ meta: { silent: true } }));

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const uploaded = await uploadFile(file, 'registry-import');
      const started = await start.mutateAsync({ fileId: uploaded.id });
      navigate(`/registry/import/${started.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The import could not start');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="grid gap-5">
      <div className="rounded-lg border border-dashed p-6 text-center">
        <FileSpreadsheet className="mx-auto mb-2 size-6 text-muted-foreground" />
        <p className="font-medium">Import an Existing Register</p>
        <p className="mx-auto mt-1 max-w-xl text-muted-foreground">
          Upload a spreadsheet (XLSX, XLS, CSV) or a PDF of the current register or its history. The AI provider reads it; you check every
          row against the file before anything becomes a draft, and nothing is committed until you commit it.
        </p>
        {!config?.aiConfigured && (
          <p className="mt-2 text-sm text-destructive">An Admin needs to set up an AI provider in Settings → AI first.</p>
        )}
        <Button className="mt-4" disabled={busy} onClick={() => input.current?.click()}>
          <Upload /> {busy ? 'Uploading…' : 'Upload a File'}
        </Button>
        <input ref={input} type="file" accept=".xlsx,.xls,.csv,.pdf" hidden onChange={(e) => onFile(e.target.files?.[0])} />
      </div>
      {imports.data?.length ? (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>By</TableHead>
                <TableHead>Started</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {imports.data.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>
                    <Link to={`/registry/import/${i.id}`} className="font-medium hover:underline">
                      {i.fileName}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant={i.status === 'failed' ? 'destructive' : i.status === 'review' ? 'default' : 'secondary'}>
                      {IMPORT_STATUS_LABELS[i.status] ?? i.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{i.createdBy}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{format.dateTime(i.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState title="No Imports Yet" />
      )}
    </div>
  );
}
