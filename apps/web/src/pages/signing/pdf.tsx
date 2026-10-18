import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Spinner } from '@/components/common';

// The legacy build polyfills the newest JS that the modern build expects, so signers on older browsers see the document.
GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfSource = { url: string; headers?: Record<string, string> } | null;

/** Loads a PDF for display. pdf.js runs no PDF scripts unless asked to, so a PDF cannot run code in the page. */
export function usePdf(source: PdfSource) {
  const [state, setState] = useState<{ doc: PDFDocumentProxy | null; error: string | null }>({ doc: null, error: null });
  const key = source ? `${source.url}|${JSON.stringify(source.headers ?? {})}` : '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key stands for the source
  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    let task: ReturnType<typeof getDocument> | null = null;
    (async () => {
      try {
        const res = await fetch(source.url, { credentials: 'same-origin', headers: source.headers });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Could not load the document (${res.status})`);
        }
        task = getDocument({ data: new Uint8Array(await res.arrayBuffer()) });
        const doc = await task.promise;
        if (!cancelled) setState({ doc, error: null });
      } catch (error) {
        if (!cancelled) setState({ doc: null, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [key]);
  return state;
}

function PdfPage({ doc, page, width, children }: { doc: PDFDocumentProxy; page: number; width: number; children?: ReactNode }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ratio, setRatio] = useState(Math.SQRT2);

  useEffect(() => {
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    (async () => {
      const p = await doc.getPage(page);
      const base = p.getViewport({ scale: 1 });
      if (cancelled || !canvas.current || width <= 0) return;
      setRatio(base.height / base.width);
      const dpr = window.devicePixelRatio || 1;
      const viewport = p.getViewport({ scale: (width / base.width) * dpr });
      canvas.current.width = Math.floor(viewport.width);
      canvas.current.height = Math.floor(viewport.height);
      task = p.render({ canvas: canvas.current, viewport });
      await task.promise.catch(() => undefined);
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, page, width]);

  return (
    <div
      className="relative mx-auto overflow-hidden rounded-sm bg-white shadow-sm ring-1 ring-border"
      style={{ width, height: width * ratio }}
    >
      <canvas ref={canvas} className="absolute inset-0 size-full" aria-label={`Page ${page}`} />
      <div className="absolute inset-0">{children}</div>
    </div>
  );
}

/**
 * Every page of a PDF at the width of its container, with an overlay per page. Overlay children place
 * themselves with percentages, so field positions are fractions of the page from its top left.
 */
export function PdfPages({
  doc,
  error,
  overlay,
  maxWidth = 860,
}: {
  doc: PDFDocumentProxy | null;
  error: string | null;
  overlay?: (page: number) => ReactNode;
  maxWidth?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!box.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.min(maxWidth, Math.floor(entry!.contentRect.width))));
    observer.observe(box.current);
    return () => observer.disconnect();
  }, [maxWidth]);

  return (
    <div ref={box} className="grid gap-4">
      {error ? (
        <p className="text-destructive">{error}</p>
      ) : !doc || !width ? (
        <Spinner className="mx-auto my-12 size-6" />
      ) : (
        Array.from({ length: doc.numPages }, (_, i) => (
          <PdfPage key={i + 1} doc={doc} page={i + 1} width={width}>
            {overlay?.(i + 1)}
          </PdfPage>
        ))
      )}
    </div>
  );
}

export const shortHash = (hash: string | null | undefined) => (hash ? `${hash.slice(0, 8)}…${hash.slice(-8)}` : '');

/** One colour per recipient, in the order they were added. */
export const RECIPIENT_COLORS = [
  'border-indigo-500 bg-indigo-500/15 text-indigo-900 dark:text-indigo-100',
  'border-emerald-500 bg-emerald-500/15 text-emerald-900 dark:text-emerald-100',
  'border-amber-500 bg-amber-500/15 text-amber-900 dark:text-amber-100',
  'border-rose-500 bg-rose-500/15 text-rose-900 dark:text-rose-100',
  'border-sky-500 bg-sky-500/15 text-sky-900 dark:text-sky-100',
  'border-fuchsia-500 bg-fuchsia-500/15 text-fuchsia-900 dark:text-fuchsia-100',
];
