import { MapPin } from "lucide-react";

type Props = {
  venueName?: string;
  courtName?: string;
  isToday: boolean;
  count?: number;
};

export function CourtHero({ venueName, courtName, isToday, count }: Props) {
  return (
    <section className="animate-rise-in pt-2 pb-1">
      <p className="flex items-center gap-1.5 text-xs font-semibold tracking-[0.18em] text-zinc-400 uppercase">
        <MapPin className="size-3.5 text-lime" />
        {venueName ?? <span className="skeleton inline-block h-3 w-28 rounded" />}
      </p>
      <h1 className="font-display mt-1 text-6xl leading-[0.9] font-black uppercase italic sm:text-7xl">
        {courtName ?? <span className="skeleton inline-block h-14 w-56 rounded-lg" />}
      </h1>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {isToday && (
          <span className="inline-flex items-center gap-2 rounded-full border border-lime/30 bg-lime/10 px-3 py-1 text-xs font-bold tracking-wider text-lime uppercase">
            <span className="animate-pulse-dot size-2 rounded-full bg-lime" />
            Ao vivo
          </span>
        )}
        {count !== undefined && (
          <span className="rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-zinc-300">
            <span className="tabular-nums text-white">{count}</span>{" "}
            {count === 1 ? "replay" : "replays"} {isToday ? "hoje" : "neste dia"}
          </span>
        )}
      </div>
    </section>
  );
}
