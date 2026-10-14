import type { ClipSummary } from "../api";
import { ClipCard } from "./ClipCard";

type Props = { hour: number; clips: ClipSummary[]; isToday: boolean };

export function HourGroup({ hour, clips, isToday }: Props) {
  return (
    <section>
      <h2 className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-20 -mx-4 mb-3 flex items-center gap-3 bg-ink/85 px-4 py-2 backdrop-blur-md">
        <span className="font-display text-3xl leading-none font-black italic">
          {String(hour).padStart(2, "0")}h
        </span>
        <span className="h-px flex-1 bg-line" />
        <span className="text-xs font-semibold text-zinc-500">
          {clips.length} {clips.length === 1 ? "replay" : "replays"}
        </span>
      </h2>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3 md:grid-cols-5">
        {clips.map((clip, i) => (
          <ClipCard key={clip.id} clip={clip} isToday={isToday} delay={Math.min(i, 8) * 40} />
        ))}
      </div>
    </section>
  );
}
