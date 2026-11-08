import { Play } from "lucide-react";
import { Link, useViewTransitionState } from "react-router";
import { isFresh, type ClipSummary } from "../api";
import { ClipThumb } from "./ClipCard";

/** O replay mais recente de hoje, grande, com CTA. */
export function FeaturedClip({ clip }: { clip: ClipSummary }) {
  const to = `/replay/${clip.id}`;
  const transitioning = useViewTransitionState(to);
  const fresh = isFresh(clip.time_local, true);

  return (
    <Link
      to={to}
      state={{ thumb: clip.thumb_url }}
      viewTransition
      className="group animate-rise-in relative flex overflow-hidden rounded-3xl border border-line bg-surface transition hover:border-white/20 active:scale-[0.99]"
    >
      <div className="relative aspect-[9/16] w-[42%] shrink-0 overflow-hidden sm:w-56">
        <ClipThumb clip={clip} transitioning={transitioning} />
      </div>
      <div className="flex flex-1 flex-col justify-between gap-4 p-4 sm:p-6">
        <div>
          <span
            className={`font-mono inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium tracking-wider ${
              fresh ? "bg-rec text-white" : "bg-white/10 text-zinc-300"
            }`}
          >
            {fresh && <span className="animate-pulse-dot size-1.5 rounded-full bg-white" />}
            {fresh ? "NOVO" : "MAIS RECENTE"}
          </span>
          <p className="font-mono mt-3 text-6xl leading-none tabular-nums sm:text-7xl">{clip.time_local}</p>
          {clip.court_name && (
            <p className="font-mono mt-1 text-[11px] font-medium tracking-wider text-zinc-400">{clip.court_name}</p>
          )}
          <p className="mt-2 text-sm text-zinc-400">Seu lance tá pronto. Assista, baixe e mande pra galera.</p>
        </div>
        <span className="inline-flex items-center justify-center gap-2 self-start rounded-full bg-white px-5 py-2.5 text-sm font-bold text-ink transition group-hover:bg-nevoa">
          <Play className="size-4 fill-current" />
          Rever
        </span>
      </div>
    </Link>
  );
}
