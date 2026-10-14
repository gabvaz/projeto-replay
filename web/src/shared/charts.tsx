import { useState } from "react";

export type DayPoint = { day: string; clips: number; views: number; downloads: number; shares: number };

function shift(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const dm = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

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

/** Barras de clips (acento) com views (cinza) ao lado; toque/hover mostra o dia. */
export function DailyChart({ series, today, days = 30 }: { series: DayPoint[]; today: string; days?: number }) {
  const data = fillDays(series, today, days);
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
            ? `${dm(active.day)} · ${active.clips} clips · ${active.views} views · ${active.downloads} downloads`
            : `Últimos ${days} dias`}
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
        <span>{dm(data[0].day)}</span>
        <span>{dm(data[Math.floor(days / 2)].day)}</span>
        <span>hoje</span>
      </div>
    </div>
  );
}

export type HeatCell = { dow: number; hour: number; n: number };

const DOW = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
/** Seg→Dom: a semana do dono de arena começa na segunda. */
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** Dia da semana × hora (BRT). Só mostra a faixa de horas com movimento (mín. 06–23). */
export function Heatmap({ cells }: { cells: HeatCell[] }) {
  const grid = new Map(cells.map((c) => [`${c.dow}|${c.hour}`, Number(c.n)]));
  const max = Math.max(1, ...cells.map((c) => Number(c.n)));
  const hours = cells.map((c) => c.hour);
  const from = Math.min(6, ...hours);
  const to = Math.max(23, ...hours);
  const range = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const [hover, setHover] = useState<HeatCell | null>(null);
  const peak = cells.reduce<HeatCell | null>((p, c) => (!p || c.n > p.n ? c : p), null);

  return (
    <div>
      <p className="mb-3 text-xs text-zinc-400">
        {hover
          ? `${DOW[hover.dow]} ${String(hover.hour).padStart(2, "0")}h · ${hover.n} clips`
          : peak
            ? `Pico: ${DOW[peak.dow]} às ${String(peak.hour).padStart(2, "0")}h`
            : "Sem clips no período"}
      </p>
      <div className="overflow-x-auto">
        <div
          className="grid min-w-[520px] gap-[3px]"
          style={{ gridTemplateColumns: `2.25rem repeat(${range.length}, minmax(0, 1fr))` }}
          onMouseLeave={() => setHover(null)}
        >
          {DOW_ORDER.map((dow) => (
            <div key={dow} className="contents">
              <span className="self-center text-[10px] text-zinc-500">{DOW[dow]}</span>
              {range.map((hour) => {
                const n = grid.get(`${dow}|${hour}`) ?? 0;
                return (
                  <button
                    key={hour}
                    type="button"
                    aria-label={`${DOW[dow]} ${hour}h: ${n} clips`}
                    onMouseEnter={() => setHover({ dow, hour, n })}
                    onClick={() => setHover({ dow, hour, n })}
                    className="aspect-square rounded-[3px] bg-white/[0.04]"
                    style={n ? { background: "var(--color-lime)", opacity: 0.18 + (n / max) * 0.82 } : undefined}
                  />
                );
              })}
            </div>
          ))}
          <span />
          {range.map((hour) => (
            <span key={hour} className="text-center text-[9px] text-zinc-600 tabular-nums">
              {hour % 3 === 0 ? hour : ""}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
