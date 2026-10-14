import { useEffect, useRef } from "react";
import { shiftDate } from "../api";

type Props = {
  today: string;
  days: number;
  value: string;
  onChange: (date: string) => void;
};

function topLabel(date: string, today: string): string {
  if (date === today) return "Hoje";
  if (date === shiftDate(today, -1)) return "Ontem";
  const d = new Date(`${date}T12:00:00Z`);
  return d.toLocaleDateString("pt-BR", { weekday: "short", timeZone: "UTC" }).replace(".", "");
}

export function DayPicker({ today, days, value, onChange }: Props) {
  const dates = Array.from({ length: days }, (_, i) => shiftDate(today, -i));
  const activeRef = useRef<HTMLButtonElement>(null);
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      if (value === today) return;
    }
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [value, today]);

  return (
    <nav
      className="no-scrollbar -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-2 overflow-x-auto px-4 py-1"
      aria-label="Escolher dia"
    >
      {dates.map((date) => {
        const active = date === value;
        return (
          <button
            key={date}
            ref={active ? activeRef : undefined}
            type="button"
            onClick={() => onChange(date)}
            aria-pressed={active}
            className={`flex w-16 shrink-0 snap-start flex-col items-center rounded-2xl border py-2 transition active:scale-95 ${
              active
                ? "border-lime bg-lime text-ink shadow-[0_8px_30px_-8px_rgb(215_255_58/0.6)]"
                : "border-line bg-surface text-zinc-300 hover:border-zinc-600"
            }`}
          >
            <span
              className={`text-[11px] font-semibold tracking-wide uppercase ${active ? "text-ink/70" : "text-zinc-500"}`}
            >
              {topLabel(date, today)}
            </span>
            <span className="font-display text-2xl leading-none font-extrabold tabular-nums">
              {date.slice(8, 10)}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
