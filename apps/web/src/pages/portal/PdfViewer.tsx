import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useEffect, useRef, useState } from 'react';
import { Spinner } from '@/components/common';

/**
 * Renders every page of a PDF with pdf.js, drawing each page only when it scrolls near the screen,
 * and reports the page most in view so the portal can record time per page.
 */
export function PdfViewer({
  url,
  onPage,
  onError,
}: {
  url: string;
  onPage: (page: number, pageCount: number) => void;
  onError: (message: string) => void;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let loaded: PDFDocumentProxy | null = null;
    (async () => {
      const pdfjs = await import('pdfjs-dist');
      const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      const response = await fetch(url, { credentials: 'same-origin' });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'The document could not be opened');
      }
      loaded = await pdfjs.getDocument({ data: new Uint8Array(await response.arrayBuffer()) }).promise;
      if (!cancelled) setPdf(loaded);
    })().catch((error: Error) => !cancelled && onError(error.message));
    return () => {
      cancelled = true;
      void loaded?.destroy();
    };
  }, [url, onError]);

  useEffect(() => {
    if (!pdf || !container.current) return;
    const ratios = new Map<number, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) ratios.set(Number((e.target as HTMLElement).dataset.page), e.intersectionRatio);
        const [best] = [...ratios.entries()].sort((a, b) => b[1] - a[1]);
        if (best && best[1] > 0) onPage(best[0], pdf.numPages);
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    for (const el of container.current.querySelectorAll('[data-page]')) observer.observe(el);
    onPage(1, pdf.numPages);
    return () => observer.disconnect();
  }, [pdf, onPage]);

  if (!pdf) return <Spinner className="m-6 size-6" />;
  return (
    <div ref={container} className="grid justify-items-center gap-4 py-4">
      {Array.from({ length: pdf.numPages }, (_, i) => (
        <PdfPage key={i} pdf={pdf} page={i + 1} />
      ))}
    </div>
  );
}

function PdfPage({ pdf, page }: { pdf: PDFDocumentProxy; page: number }) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(page <= 2);
  const [aspect, setAspect] = useState(Math.SQRT2);

  useEffect(() => {
    const el = holder.current;
    if (!el || near) return;
    const observer = new IntersectionObserver(([e]) => e?.isIntersecting && setNear(true), { rootMargin: '800px 0px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [near]);

  useEffect(() => {
    if (!near || !canvas.current) return;
    let task: { cancel: () => void } | undefined;
    let cancelled = false;
    void pdf.getPage(page).then((p) => {
      if (cancelled || !canvas.current || !holder.current) return;
      const base = p.getViewport({ scale: 1 });
      setAspect(base.height / base.width);
      const scale = (holder.current.clientWidth / base.width) * Math.min(window.devicePixelRatio || 1, 2);
      const viewport = p.getViewport({ scale });
      canvas.current.width = viewport.width;
      canvas.current.height = viewport.height;
      const render = p.render({ canvas: canvas.current, viewport });
      task = render;
      render.promise.catch(() => undefined);
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [near, pdf, page]);

  return (
    <div
      ref={holder}
      data-page={page}
      className="relative w-full max-w-3xl overflow-hidden rounded-sm border bg-white"
      style={{ aspectRatio: `1 / ${aspect}` }}
    >
      <canvas ref={canvas} className="absolute inset-0 size-full" aria-label={`Page ${page}`} />
    </div>
  );
}
