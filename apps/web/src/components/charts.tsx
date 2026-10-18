import { cn } from '@/lib/utils';

export interface ChartSeries {
  key: string;
  name: string;
  color: string;
}

const W = 640;
const H = 240;
const PAD = { top: 12, right: 12, bottom: 28, left: 52 };

function ticks(max: number, count = 4) {
  if (max <= 0) return [0];
  const step = 10 ** Math.floor(Math.log10(max / count));
  const nice = [1, 2, 2.5, 5, 10].map((m) => m * step).find((s) => max / s <= count) ?? step * 10;
  return Array.from({ length: Math.floor(max / nice) + 1 }, (_, i) => i * nice);
}

function Legend({ series }: { series: ChartSeries[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {series.map((s) => (
        <span key={s.key} className="flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-sm" style={{ background: s.color }} />
          {s.name}
        </span>
      ))}
    </div>
  );
}

/** Stacked areas of shares that add up to 100% at every point, such as ownership per group over time. */
export function StackedAreaChart({
  series,
  points,
  markers = [],
  onMarker,
  className,
}: {
  series: ChartSeries[];
  points: { label: string; values: Record<string, number> }[];
  markers?: number[];
  onMarker?: (index: number) => void;
  className?: string;
}) {
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length <= 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v: number) => PAD.top + ih - (v / 100) * ih;
  let below = points.map(() => 0);
  const areas = series.map((s) => {
    const top = points.map((p, i) => below[i]! + (p.values[s.key] ?? 0));
    const path = [...top.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`), ...below.map((v, i) => `L${x(i)},${y(v)}`).reverse(), 'Z'].join(
      ' ',
    );
    below = top;
    return { s, path };
  });
  const every = Math.max(1, Math.ceil(points.length / 6));
  return (
    <div className={cn('grid gap-2', className)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Chart">
        {[0, 25, 50, 75, 100].map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="stroke-border" />
            <text x={PAD.left - 6} y={y(t) + 3} textAnchor="end" className="fill-muted-foreground font-mono text-[10px]">
              {t}%
            </text>
          </g>
        ))}
        {areas.map(({ s, path }) => (
          <path key={s.key} d={path} fill={s.color} fillOpacity={0.85} />
        ))}
        {markers.map((i) => (
          <line
            key={i}
            x1={x(i)}
            x2={x(i)}
            y1={PAD.top}
            y2={PAD.top + ih}
            strokeDasharray="3 3"
            className={cn('stroke-foreground/60', onMarker && 'cursor-pointer')}
            strokeWidth={2}
            onClick={() => onMarker?.(i)}
          />
        ))}
        {points.map((p, i) =>
          i % every === 0 || i === points.length - 1 ? (
            <text key={p.label} x={x(i)} y={H - 8} textAnchor="middle" className="fill-muted-foreground font-mono text-[10px]">
              {p.label}
            </text>
          ) : null,
        )}
      </svg>
      <Legend series={series} />
    </div>
  );
}

/** Lines over a numeric x axis, such as payout per holder across exit values. */
export function LineChart({
  series,
  points,
  formatX = String,
  formatY = String,
  className,
}: {
  series: ChartSeries[];
  points: { x: number; values: Record<string, number> }[];
  formatX?: (v: number) => string;
  formatY?: (v: number) => string;
  className?: string;
}) {
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const maxX = Math.max(...points.map((p) => p.x), 1);
  const maxY = Math.max(...points.flatMap((p) => Object.values(p.values)), 1);
  const yTicks = ticks(maxY);
  const top = Math.max(maxY, yTicks.at(-1)!);
  const x = (v: number) => PAD.left + (v / maxX) * iw;
  const y = (v: number) => PAD.top + ih - (v / top) * ih;
  return (
    <div className={cn('grid gap-2', className)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Chart">
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="stroke-border" />
            <text x={PAD.left - 6} y={y(t) + 3} textAnchor="end" className="fill-muted-foreground font-mono text-[10px]">
              {formatY(t)}
            </text>
          </g>
        ))}
        {series.map((s) => (
          <polyline
            key={s.key}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            points={points.map((p) => `${x(p.x)},${y(p.values[s.key] ?? 0)}`).join(' ')}
          />
        ))}
        {ticks(maxX).map((t) => (
          <text key={t} x={x(t)} y={H - 8} textAnchor="middle" className="fill-muted-foreground font-mono text-[10px]">
            {formatX(t)}
          </text>
        ))}
      </svg>
      <Legend series={series} />
    </div>
  );
}

/** One horizontal bar split into parts, for ownership at a glance. */
export function ShareBar({
  parts,
  className,
}: {
  parts: { key: string; name: string; value: number; color: string }[];
  className?: string;
}) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <div className={cn('grid gap-2', className)}>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
        {parts.map((p) => (
          <div
            key={p.key}
            title={`${p.name}: ${((p.value / total) * 100).toFixed(2)}%`}
            style={{ width: `${(p.value / total) * 100}%`, background: p.color }}
          />
        ))}
      </div>
      <Legend series={parts.map((p) => ({ key: p.key, name: `${p.name} ${((p.value / total) * 100).toFixed(1)}%`, color: p.color }))} />
    </div>
  );
}
