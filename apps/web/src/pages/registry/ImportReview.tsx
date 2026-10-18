import { HOLDER_KINDS, type HolderKind, type ImportExtraction, type ImportSource } from '@openinc/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { ConfirmButton, Spinner } from '@/components/common';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCan } from '@/lib/session';
import { type RouterOutputs, useTRPC } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { HOLDER_KIND_LABELS } from './common';
import { IMPORT_STATUS_LABELS } from './ImportTab';

type ImportData = RouterOutputs['registry']['getImport'];
type Issue = NonNullable<ImportData['result']>['issues'][number];

function columnIndex(letters: string) {
  return letters.split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
}

function Confidence({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <Badge variant={value < 0.6 ? 'destructive' : value < 0.85 ? 'secondary' : 'outline'} className="font-mono" title="How sure the AI was">
      {pct}%
    </Badge>
  );
}

/** The uploaded file, with the cell or line the selected row came from highlighted. */
function SourceView({ data, selected }: { data: ImportData; selected: ImportSource | null }) {
  const source = data.source;
  const [sheet, setSheet] = useState(0);
  const [page, setPage] = useState(0);
  const mark = useRef<HTMLElement | null>(null);
  const setMark = (el: HTMLElement | null) => {
    mark.current = el;
  };
  useEffect(() => {
    if (!selected || !source) return;
    if (source.kind === 'sheet') {
      const i = source.sheets.findIndex((s) => s.name === selected.sheet);
      if (i >= 0) setSheet(i);
    } else if (selected.page) setPage(selected.page - 1);
  }, [selected, source]);
  useEffect(() => {
    mark.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
  if (!source) return <Spinner />;
  const cell = selected?.cell ? /^([A-Z]+)(\d+)$/.exec(selected.cell.toUpperCase()) : null;
  const target = cell ? { col: columnIndex(cell[1]!), row: Number(cell[2]) - 1 } : null;

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {source.kind === 'sheet'
          ? source.sheets.map((s, i) => (
              <Button key={s.name} size="sm" variant={i === sheet ? 'secondary' : 'ghost'} onClick={() => setSheet(i)}>
                {s.name}
              </Button>
            ))
          : source.pages.map((_, i) => (
              <Button key={i} size="sm" variant={i === page ? 'secondary' : 'ghost'} onClick={() => setPage(i)}>
                Page {i + 1}
              </Button>
            ))}
        <Button size="sm" variant="ghost" className="ml-auto" asChild>
          <a href={data.file.url} target="_blank" rel="noreferrer">
            <ExternalLink /> Original
          </a>
        </Button>
      </div>
      {source.encoding && (
        <p className="text-xs text-muted-foreground">
          Read as {source.encoding}, separated by "{source.delimiter === '\t' ? 'tab' : source.delimiter}"
        </p>
      )}
      {source.scanned && <p className="text-xs text-muted-foreground">The pages are scanned images; the AI read the PDF itself.</p>}
      <div className="max-h-[70vh] overflow-auto rounded-lg border font-mono text-xs">
        {source.kind === 'sheet' ? (
          <table className="border-collapse">
            <tbody>
              {(source.sheets[sheet]?.rows ?? []).map((row, r) => (
                <tr key={r}>
                  <td className="sticky left-0 border-r bg-muted px-2 text-right text-muted-foreground">{r + 1}</td>
                  {row.map((value, c) => {
                    const hit = target?.row === r && target.col === c && source.sheets[sheet]?.name === selected?.sheet;
                    const rowHit = target?.row === r && source.sheets[sheet]?.name === selected?.sheet;
                    return (
                      <td
                        key={c}
                        ref={hit ? setMark : undefined}
                        className={cn(
                          'border-b border-r px-2 py-1 whitespace-nowrap',
                          rowHit && 'bg-primary/5',
                          hit && 'bg-primary/20 outline-2 outline-primary',
                        )}
                      >
                        {value}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <ol className="p-2">
            {(source.pages[page] ?? []).map((line, l) => {
              const hit = selected?.page === page + 1 && selected.line === l + 1;
              return (
                <li key={l} ref={hit ? setMark : undefined} className={cn('flex gap-3 px-1', hit && 'bg-primary/20')}>
                  <span className="w-8 shrink-0 text-right text-muted-foreground">{l + 1}</span>
                  <span>{line}</span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

function issuesFor(issues: Issue[], path: string) {
  return issues.filter((i) => i.path === path || i.path.startsWith(`${path}.`));
}

function RowIssues({ issues }: { issues: Issue[] }) {
  if (!issues.length) return null;
  return (
    <ul className="mt-1 grid gap-0.5 text-xs">
      {issues.map((i, n) => (
        <li key={n} className={i.severity === 'error' ? 'text-destructive' : 'text-muted-foreground'}>
          {i.message}
        </li>
      ))}
    </ul>
  );
}

function Row({
  selected,
  onSelect,
  invalid,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  invalid: boolean;
  children: React.ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a row of inputs; the click only points the source pane at its cell
    <div
      role="button"
      tabIndex={-1}
      onClick={onSelect}
      className={cn('rounded-md border p-2', selected && 'border-primary bg-primary/5', invalid && 'border-destructive')}
    >
      {children}
    </div>
  );
}

export function ImportReview() {
  const { id = '' } = useParams();
  const trpc = useTRPC();
  const can = useCan();
  const queryClient = useQueryClient();
  const query = useQuery(
    trpc.registry.getImport.queryOptions(
      { importId: id },
      { refetchInterval: (q) => (q.state.data?.status === 'extracting' ? 2000 : false) },
    ),
  );
  const [edited, setEdited] = useState<ImportExtraction | null>(null);
  const [selected, setSelected] = useState<{ key: string; source: ImportSource } | null>(null);
  const [committing, setCommitting] = useState(false);
  const data = query.data;
  useEffect(() => {
    if (data?.result && !edited) setEdited(data.result.extraction);
  }, [data, edited]);
  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.registry.pathKey() });
  const update = useMutation(trpc.registry.updateImport.mutationOptions({ onSuccess: refresh }));
  const drafts = useMutation(trpc.registry.createImportDrafts.mutationOptions({ onSuccess: refresh }));
  const discard = useMutation(trpc.registry.discardImport.mutationOptions({ onSuccess: refresh }));
  const commit = useMutation(trpc.registry.commit.mutationOptions({ meta: { silent: true } }));

  if (query.isError)
    return (
      <Alert variant="destructive">
        <AlertTitle>Could Not Load the Import</AlertTitle>
        <AlertDescription>{query.error.message}</AlertDescription>
      </Alert>
    );
  if (!data) return <Spinner />;
  const back = (
    <Link to="/registry/import" className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-3" /> Import
    </Link>
  );
  if (data.status === 'extracting')
    return (
      <div className="grid gap-3">
        {back}
        <div className="flex items-center gap-3 rounded-lg border p-6">
          <Spinner className="size-5" />
          <div>
            <div className="font-medium">Reading {data.file.name}</div>
            <div className="text-muted-foreground">The AI provider is going through the file. This can take a minute.</div>
          </div>
        </div>
      </div>
    );
  if (data.status === 'failed')
    return (
      <div className="grid gap-3">
        {back}
        <Alert variant="destructive">
          <AlertTitle>The Import Failed</AlertTitle>
          <AlertDescription>{data.error}</AlertDescription>
        </Alert>
      </div>
    );
  if (!data.result || !edited) return <Spinner />;

  const issues = data.result.issues;
  const errors = issues.filter((i) => i.severity === 'error');
  const dirty = JSON.stringify(edited) !== JSON.stringify(data.result.extraction);
  const set = (patch: Partial<ImportExtraction>) => setEdited({ ...edited, ...patch });
  const holderName = (ref: string | null) => edited.holders.find((h) => h.ref === ref)?.name ?? ref ?? '—';
  const pickRow = (key: string, source: ImportSource) => setSelected({ key, source });
  const editable = data.status === 'review';

  const commitAll = async () => {
    setCommitting(true);
    try {
      for (const txId of data.draftTxIds) await commit.mutateAsync({ transactionId: txId });
      toast.success('Entered in the register');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Commit failed');
    } finally {
      setCommitting(false);
      await refresh();
    }
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {back}
          <h2 className="text-lg font-semibold">{data.file.name}</h2>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary">{IMPORT_STATUS_LABELS[data.status]}</Badge>
            {edited.mode === 'snapshot' ? 'A register on one date' : 'A history of transactions'}
            {data.result.tokenized > 0 && <span>· {data.result.tokenized} ID numbers were hidden from the AI</span>}
          </div>
        </div>
        {editable && (
          <div className="flex flex-wrap gap-2">
            <ConfirmButton
              label="Discard"
              title="Discard This Import?"
              description="Nothing was entered in the register."
              onConfirm={() => discard.mutate({ importId: id })}
            />
            <Button
              variant="outline"
              disabled={!dirty || update.isPending}
              onClick={() => update.mutate({ importId: id, extraction: edited })}
            >
              Check Again
            </Button>
            <Button disabled={dirty || errors.length > 0 || drafts.isPending} onClick={() => drafts.mutate({ importId: id })}>
              Create Drafts
            </Button>
          </div>
        )}
      </div>

      {data.status === 'committed' && (
        <Alert>
          <AlertTitle>Drafts Created</AlertTitle>
          <AlertDescription>
            <div className="grid gap-2">
              <span>
                {data.draftTxIds.length} draft transaction{data.draftTxIds.length === 1 ? '' : 's'} wait in the ledger. Commit them there
                one by one, or all in order here.
              </span>
              <div className="flex flex-wrap gap-2">
                {data.draftTxIds.map((txId, i) => (
                  <Button key={txId} size="sm" variant="outline" asChild>
                    <Link to={`/registry/transactions/${txId}`}>Draft {i + 1}</Link>
                  </Button>
                ))}
                {can('registry.commit') && (
                  <Button size="sm" disabled={committing} onClick={commitAll}>
                    Commit All in Order
                  </Button>
                )}
              </div>
            </div>
          </AlertDescription>
        </Alert>
      )}
      {errors.length > 0 && (
        <Alert variant="destructive">
          <AlertTitle>
            {errors.length} Problem{errors.length === 1 ? '' : 's'} to Fix
          </AlertTitle>
          <AlertDescription>Fix the marked rows, or the file, then click Check Again.</AlertDescription>
        </Alert>
      )}
      {dirty && (
        <p className="text-sm text-muted-foreground">You changed rows. Click Check Again to run the checks before creating drafts.</p>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="grid content-start gap-4">
          <section className="grid gap-2">
            <h3 className="font-medium">Company</h3>
            <Row
              selected={selected?.key === 'company'}
              onSelect={() => pickRow('company', edited.company.source)}
              invalid={issuesFor(issues, 'company').some((i) => i.severity === 'error')}
            >
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="grid gap-1 text-xs">
                  Share Capital
                  <Input
                    disabled={!editable}
                    value={edited.company.shareCapital ?? ''}
                    onChange={(e) => set({ company: { ...edited.company, shareCapital: e.target.value } })}
                  />
                </label>
                <label className="grid gap-1 text-xs">
                  As of Date
                  <Input
                    disabled={!editable}
                    value={edited.company.asOfDate ?? ''}
                    onChange={(e) => set({ company: { ...edited.company, asOfDate: e.target.value } })}
                  />
                </label>
                <label className="grid gap-1 text-xs">
                  Registration Number
                  <Input
                    disabled={!editable}
                    value={edited.company.nationalNumber ?? ''}
                    onChange={(e) => set({ company: { ...edited.company, nationalNumber: e.target.value } })}
                  />
                </label>
              </div>
              <RowIssues issues={issuesFor(issues, 'company')} />
            </Row>
            <div className="flex flex-wrap gap-2 text-xs">
              {edited.classes.map((c, i) => (
                <button key={i} type="button" onClick={() => pickRow(`class-${i}`, c.source)} className="rounded-md border px-2 py-1">
                  Class <span className="font-mono">{c.code}</span> · {c.votesPerShare} votes per share
                </button>
              ))}
            </div>
          </section>

          <section className="grid gap-2">
            <h3 className="font-medium">Holders</h3>
            {edited.holders.map((h, i) => {
              const rowIssues = issuesFor(issues, `holders.${i}`);
              const change = (patch: Partial<typeof h>) =>
                set({ holders: edited.holders.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
              return (
                <Row
                  key={h.ref}
                  selected={selected?.key === `holder-${i}`}
                  onSelect={() => pickRow(`holder-${i}`, h.source)}
                  invalid={rowIssues.some((x) => x.severity === 'error')}
                >
                  <div className="flex items-center gap-2">
                    <Input aria-label="Name" disabled={!editable} value={h.name} onChange={(e) => change({ name: e.target.value })} />
                    <Confidence value={h.confidence} />
                  </div>
                  <div className="mt-2 grid items-center gap-2 sm:grid-cols-[1fr_9rem]">
                    <Input
                      aria-label="ID Number"
                      className="font-mono"
                      disabled={!editable}
                      value={h.nationalId}
                      onChange={(e) => change({ nationalId: e.target.value })}
                    />
                    <Select disabled={!editable} value={h.kind} onValueChange={(v) => change({ kind: v as HolderKind })}>
                      <SelectTrigger aria-label="Kind" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {HOLDER_KINDS.map((k) => (
                          <SelectItem key={k} value={k}>
                            {HOLDER_KIND_LABELS[k]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <RowIssues issues={rowIssues} />
                </Row>
              );
            })}
          </section>

          {edited.mode === 'snapshot' ? (
            <section className="grid gap-2">
              <h3 className="font-medium">Holdings</h3>
              {edited.holdings.map((h, i) => {
                const rowIssues = issuesFor(issues, `holdings.${i}`);
                const change = (patch: Partial<typeof h>) =>
                  set({ holdings: edited.holdings.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                return (
                  <Row
                    key={i}
                    selected={selected?.key === `holding-${i}`}
                    onSelect={() => pickRow(`holding-${i}`, h.source)}
                    invalid={rowIssues.some((x) => x.severity === 'error')}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2 text-sm font-medium">
                      {holderName(h.holderRef)}
                      <Confidence value={h.confidence} />
                    </div>
                    <div className="grid items-center gap-2 sm:grid-cols-[4rem_8rem_1fr]">
                      <Input
                        aria-label="Class"
                        disabled={!editable}
                        value={h.classCode}
                        onChange={(e) => change({ classCode: e.target.value })}
                      />
                      <Input
                        aria-label="Shares"
                        className="font-mono"
                        disabled={!editable}
                        value={h.count}
                        onChange={(e) => change({ count: e.target.value })}
                      />
                      <Input
                        aria-label="Share Numbers"
                        className="font-mono"
                        disabled={!editable}
                        value={h.shareNumbers}
                        onChange={(e) => change({ shareNumbers: e.target.value })}
                      />
                    </div>
                    <RowIssues issues={rowIssues} />
                  </Row>
                );
              })}
            </section>
          ) : (
            <section className="grid gap-2">
              <h3 className="font-medium">History</h3>
              {edited.events.map((e, i) => {
                const rowIssues = issuesFor(issues, `events.${i}`);
                const change = (patch: Partial<typeof e>) =>
                  set({ events: edited.events.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                return (
                  <Row
                    key={i}
                    selected={selected?.key === `event-${i}`}
                    onSelect={() => pickRow(`event-${i}`, e.source)}
                    invalid={rowIssues.some((x) => x.severity === 'error')}
                  >
                    <div className="grid items-center gap-2 sm:grid-cols-[7rem_1fr_6rem_auto]">
                      <Input
                        aria-label="Date"
                        className="font-mono"
                        disabled={!editable}
                        value={e.date}
                        onChange={(ev) => change({ date: ev.target.value })}
                      />
                      <span className="truncate text-sm">
                        {e.type.replace('_', ' ')}: {e.fromRef ? `${holderName(e.fromRef)} → ` : ''}
                        {holderName(e.toRef)} {e.classCode}
                      </span>
                      <Input
                        aria-label="Shares"
                        className="font-mono"
                        disabled={!editable}
                        value={e.count}
                        onChange={(ev) => change({ count: ev.target.value })}
                      />
                      <Confidence value={e.confidence} />
                    </div>
                    {e.description && <p className="mt-1 text-xs text-muted-foreground">{e.description}</p>}
                    <RowIssues issues={rowIssues} />
                  </Row>
                );
              })}
            </section>
          )}

          {(edited.notes.length > 0 || issuesFor(issues, 'register').length > 0 || issuesFor(issues, 'transactions').length > 0) && (
            <section className="grid gap-1 text-sm">
              <h3 className="font-medium">Notes</h3>
              <RowIssues
                issues={[
                  ...issuesFor(issues, 'register'),
                  ...issuesFor(issues, 'transactions'),
                  ...issuesFor(issues, 'events').filter((x) => x.path === 'events'),
                ]}
              />
              {edited.notes.map((n, i) => (
                <p key={i} className="text-muted-foreground">
                  {n}
                </p>
              ))}
            </section>
          )}
        </div>
        <div className="xl:sticky xl:top-4 xl:self-start">
          <SourceView data={data} selected={selected?.source ?? null} />
        </div>
      </div>
    </div>
  );
}
