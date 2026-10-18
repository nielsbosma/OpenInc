import { ENVELOPE_STATUS_LABELS, type EnvelopeStatus } from '@openinc/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { FileSignature, FileText, Plus, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link, Route, Routes, useNavigate } from 'react-router';
import { EmptyState, PageHeader, Spinner } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCan, useFormat } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { EnvelopePage } from './EnvelopePage';

const STATUS_VARIANT: Record<EnvelopeStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  draft: 'outline',
  sent: 'secondary',
  completed: 'default',
  declined: 'destructive',
  voided: 'outline',
  expired: 'outline',
};

export function EnvelopeStatusBadge({ status }: { status: string }) {
  const s = status as EnvelopeStatus;
  return <Badge variant={STATUS_VARIANT[s] ?? 'outline'}>{ENVELOPE_STATUS_LABELS[s] ?? status}</Badge>;
}

export function SigningRoutes() {
  return (
    <Routes>
      <Route index element={<EnvelopesPage />} />
      <Route path=":envelopeId" element={<EnvelopePage />} />
    </Routes>
  );
}

function EnvelopesPage() {
  const trpc = useTRPC();
  const can = useCan();
  const format = useFormat();
  const [picking, setPicking] = useState(false);
  const list = useQuery(trpc.signing.list.queryOptions({}));

  return (
    <>
      <PageHeader
        title="Signing"
        description="Documents sent for signature. Signers verify their email with a one-time code, and the signed PDF is sealed and filed next to the original."
        actions={
          <>
            <Button variant="outline" asChild>
              <a href="/verify" target="_blank" rel="noreferrer">
                <ShieldCheck /> Verify a PDF
              </a>
            </Button>
            {can('signing.send') && (
              <Button onClick={() => setPicking(true)}>
                <Plus /> New Envelope
              </Button>
            )}
          </>
        }
      />
      {list.isLoading ? (
        <Spinner />
      ) : !list.data?.length ? (
        <EmptyState icon={<FileSignature />} title="Nothing Sent for Signature Yet">
          {can('signing.send')
            ? 'Click New Envelope, or choose Send for Signature on a PDF in Documents.'
            : 'Envelopes appear here once someone sends a document for signature.'}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead className="w-44">Status</TableHead>
                <TableHead className="hidden w-28 sm:table-cell">Signed</TableHead>
                <TableHead className="hidden w-40 md:table-cell">Sent By</TableHead>
                <TableHead className="hidden w-44 md:table-cell">Sent</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <Link to={`/documents/signing/${e.id}`} className="grid gap-0.5 hover:underline">
                      <span className="truncate font-medium">{e.title}</span>
                      <span className="truncate text-xs text-muted-foreground">{e.recipients.join(', ') || 'No signers yet'}</span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <EnvelopeStatusBadge status={e.status} />
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs sm:table-cell">
                    {e.signed} / {e.signers}
                  </TableCell>
                  <TableCell className="hidden truncate text-muted-foreground md:table-cell">{e.sentBy ?? '—'}</TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{e.sentAt ? format.dateTime(e.sentAt) : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <PickDocumentDialog open={picking} onOpenChange={setPicking} />
    </>
  );
}

/** New Envelope starts from a PDF already in Documents. */
function PickDocumentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const results = useQuery({
    ...trpc.documents.search.queryOptions({ query: query.trim(), contentType: 'application/pdf' }),
    enabled: open,
  });
  const create = useMutation(trpc.signing.create.mutationOptions({ onSuccess: ({ id }) => navigate(`/documents/signing/${id}`) }));
  const pdfs = results.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pick a Document</DialogTitle>
          <DialogDescription>
            Choose a PDF from Documents to send for signature. Upload it to Documents first if it is not there.
          </DialogDescription>
        </DialogHeader>
        <Input autoFocus placeholder="Search documents" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="grid max-h-72 gap-1 overflow-y-auto">
          {results.isLoading ? (
            <Spinner />
          ) : pdfs.length === 0 ? (
            <p className="py-6 text-center text-muted-foreground">No PDFs match.</p>
          ) : (
            pdfs.map((d) => (
              <button
                key={d.id}
                type="button"
                disabled={create.isPending}
                onClick={() => create.mutate({ documentId: d.id })}
                className="flex items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-accent disabled:opacity-50"
              >
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="grid min-w-0">
                  <span className="truncate">{d.name}</span>
                  {d.folderPath && <span className="truncate text-xs text-muted-foreground">{d.folderPath}</span>}
                </span>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
