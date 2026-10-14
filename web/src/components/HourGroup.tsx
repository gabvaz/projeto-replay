import type { ClipSummary } from "../api";
import { ClipCard } from "./ClipCard";

export function HourGroup({ hour, clips }: { hour: number; clips: ClipSummary[] }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-zinc-400">
        {String(hour).padStart(2, "0")}h
        <span className="ml-2 font-normal text-zinc-500">
          {clips.length} {clips.length === 1 ? "replay" : "replays"}
        </span>
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {clips.map((clip) => (
          <ClipCard key={clip.id} clip={clip} />
        ))}
      </div>
    </section>
  );
}
