import { shiftDate } from "../api";

type Props = {
  today: string;
  days: number;
  value: string;
  onChange: (date: string) => void;
};

function label(date: string, today: string): string {
  if (date === today) return "Hoje";
  if (date === shiftDate(today, -1)) return "Ontem";
  const d = new Date(`${date}T12:00:00Z`);
  const weekday = d.toLocaleDateString("pt-BR", { weekday: "short", timeZone: "UTC" }).replace(".", "");
  return `${weekday} ${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

export function DayPicker({ today, days, value, onChange }: Props) {
  const dates = Array.from({ length: days }, (_, i) => shiftDate(today, -i));
  return (
    <nav className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" aria-label="Escolher dia">
      {dates.map((date) => {
        const active = date === value;
        return (
          <button
            key={date}
            type="button"
            onClick={() => onChange(date)}
            aria-pressed={active}
            className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium capitalize transition ${
              active ? "bg-brand text-zinc-950" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
            }`}
          >
            {label(date, today)}
          </button>
        );
      })}
    </nav>
  );
}
