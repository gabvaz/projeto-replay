import { useState } from "react";
import type { DayPoint } from "./api";

function shift(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Preenche dias sem evento com zero, pra o eixo não pular. */
export function fillDays(series: DayPoint[], today: string, days = 30): DayPoint[] {
  const byDay = new Map(series.map((p) => [p.day, p]));
  return Array.from({ length: days }, (_, i) => {
    const day = shift(today, i - days + 1);
    const p = byDay.get(day);
    return {
      day,
      clips: Number(p?.clips ?? 0),
      views: Number(p?.views ?? 0),
      downloads: Number(p?.downloads ?? 0),
      shares: Number(p?.shares ?? 0),
    };
  });
}

const H = 140;

/** Barras de clips (lime) com views (cinza) ao lado; toque/hover mostra o dia. */
export function DailyChart({ series, today }: { series: DayPoint[]; today: string }) {
  const data = fillDays(series, today);
  const max = Math.max(1, ...data.flatMap((d) => [d.clips, d.views]));
  const [hover, setHover] = useState<number | null>(null);
  const active = hover !== null ? data[hover] : null;
  const w = 100 / data.length;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex gap-4 text-zinc-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-lime" /> Clips
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-zinc-500" /> Views
          </span>
        </div>
        <span className="text-zinc-400 tabular-nums">
          {active
            ? `${active.day.slice(8, 10)}/${active.day.slice(5, 7)} · ${active.clips} clips · ${active.views} views · ${active.downloads} downloads`
            : "Últimos 30 dias"}
        </span>
      </div>
      <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" className="h-36 w-full" onMouseLeave={() => setHover(null)}>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2="100" y1={H * f} y2={H * f} stroke="var(--color-line)" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
        ))}
        {data.map((d, i) => {
          const ch = (d.clips / max) * (H - 4);
          const vh = (d.views / max) * (H - 4);
          const x = i * w;
          return (
            <g key={d.day} opacity={hover === null || hover === i ? 1 : 0.45}>
              <rect x={x + w * 0.12} y={H - ch} width={w * 0.38} height={ch} rx="0.4" fill="var(--color-lime)" />
              <rect x={x + w * 0.52} y={H - vh} width={w * 0.36} height={vh} rx="0.4" fill="#71717a" />
              <rect
                x={x}
                y="0"
                width={w}
                height={H}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onClick={() => setHover(i)}
              />
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-zinc-600 tabular-nums">
        <span>{data[0].day.slice(8, 10)}/{data[0].day.slice(5, 7)}</span>
        <span>{data[14].day.slice(8, 10)}/{data[14].day.slice(5, 7)}</span>
        <span>hoje</span>
      </div>
    </div>
  );
}
