import { CheckCircle2, FileQuestion, ShieldAlert, Upload } from 'lucide-react';
import { useState } from 'react';
import { Spinner } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { SignerLayout } from './SignPage';

type Result = {
  outcome: 'valid' | 'not_signed' | 'invalid' | 'modified' | 'unknown_signer';
  hash: string;
  certificate: { subject: string; issuer: string; fingerprint: string } | null;
  envelope: {
    id: string;
    title: string;
    documentHash: string;
    completedAt: string | null;
    chainOk: boolean;
    signers: { name: string; email: string; signedAt: string | null }[];
  } | null;
};

const OUTCOMES: Record<Result['outcome'], { title: string; text: string; ok: boolean }> = {
  valid: { title: 'Dokumentet Är Äkta', text: 'Stämpeln är giltig och filen är oförändrad sedan den förseglades.', ok: true },
  not_signed: { title: 'Ingen Elektronisk Stämpel', text: 'Filen saknar en elektronisk stämpel från den här tjänsten.', ok: false },
  invalid: {
    title: 'Dokumentet Har Ändrats',
    text: 'Stämpeln stämmer inte med innehållet. Filen har ändrats efter att den förseglades.',
    ok: false,
  },
  modified: {
    title: 'Innehåll Har Lagts Till',
    text: 'Den förseglade delen är oförändrad, men något har lagts till i filen efteråt. Begär en ny kopia från avsändaren.',
    ok: false,
  },
  unknown_signer: {
    title: 'Okänd Utfärdare',
    text: 'Stämpeln är tekniskt giltig men kommer inte från den här tjänsten.',
    ok: false,
  },
};

const when = (d: string | null) =>
  d ? new Intl.DateTimeFormat('sv-SE', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(d)) : '—';

export function VerifyPage() {
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');

  const check = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setName(file.name);
    try {
      const res = await fetch('/api/signing/verify', { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Kunde inte kontrollera filen');
      setResult(body as Result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const outcome = result && OUTCOMES[result.outcome];

  return (
    <SignerLayout>
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-lg">Kontrollera ett Signerat Dokument</CardTitle>
          <CardDescription>
            Välj en PDF som har signerats här. Filen kontrolleras mot sin elektroniska stämpel och sparas inte.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <label
            className={cn(
              'flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-8 text-center text-sm text-muted-foreground hover:bg-muted/50',
              busy && 'pointer-events-none opacity-60',
            )}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void check(e.dataTransfer.files[0]);
            }}
          >
            {busy ? <Spinner className="size-6" /> : <Upload className="size-6" />}
            <span>{name || 'Släpp en PDF här eller klicka för att välja'}</span>
            <input type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => void check(e.target.files?.[0])} />
          </label>

          {error && <p className="text-sm text-destructive">{error}</p>}

          {result && outcome && (
            <div
              className={cn(
                'grid gap-3 rounded-lg border p-4',
                outcome.ok ? 'border-success/40 bg-success/5' : 'border-destructive/40 bg-destructive/5',
              )}
            >
              <div className="flex items-start gap-3">
                {outcome.ok ? (
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
                ) : result.outcome === 'not_signed' ? (
                  <FileQuestion className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                ) : (
                  <ShieldAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
                )}
                <div className="grid gap-1">
                  <p className="font-medium">{outcome.title}</p>
                  <p className="text-sm text-muted-foreground">{outcome.text}</p>
                </div>
              </div>
              {result.envelope && (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                  <dt className="text-muted-foreground">Dokument</dt>
                  <dd>{result.envelope.title}</dd>
                  <dt className="text-muted-foreground">Slutfört</dt>
                  <dd>{when(result.envelope.completedAt)}</dd>
                  {result.envelope.signers.map((s) => (
                    <div key={s.email} className="contents">
                      <dt className="text-muted-foreground">Signerat av</dt>
                      <dd>
                        {s.name} <span className="text-muted-foreground">({s.email})</span>, {when(s.signedAt)}
                      </dd>
                    </div>
                  ))}
                  <dt className="text-muted-foreground">Händelsekedja</dt>
                  <dd>{result.envelope.chainOk ? 'Intakt' : 'Bruten'}</dd>
                </dl>
              )}
              {result.certificate && (
                <p className="text-xs break-all text-muted-foreground">
                  Förseglat av {result.certificate.subject}, utfärdat av {result.certificate.issuer}. Fingeravtryck{' '}
                  <span className="font-mono">{result.certificate.fingerprint}</span>
                </p>
              )}
              <p className="text-xs break-all text-muted-foreground">
                Filens SHA-256 <span className="font-mono">{result.hash}</span>
              </p>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Vill du kontrollera stämpeln i Adobe Acrobat eller ett annat program? Lägg till{' '}
            <Button variant="link" asChild className="h-auto p-0 text-xs">
              <a href="/api/signing/ca.pem">tjänstens rotcertifikat</a>
            </Button>{' '}
            som betrott certifikat.
          </p>
        </CardContent>
      </Card>
    </SignerLayout>
  );
}
