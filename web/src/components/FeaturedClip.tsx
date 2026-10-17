import { Play } from "lucide-react";
import { Link, useViewTransitionState } from "react-router";
import { isFresh, type ClipSummary } from "../api";
import { ClipThumb } from "./ClipCard";

/** O replay mais recente de hoje, grande, com CTA. */
export function FeaturedClip({ clip }: { clip: ClipSummary }) {
  const to = `/v/${clip.id}`;
  const transitioning = useViewTransitionState(to);
  const fresh = isFresh(clip.time_local, true);

  return (
    <Link
      to={to}
      state={{ thumb: clip.thumb_url }}
      viewTransition
      className="group animate-rise-in relative flex overflow-hidden rounded-3xl border border-line bg-surface transition hover:border-lime/50 active:scale-[0.99]"
    >
      <div className="relative aspect-[9/16] w-[42%] shrink-0 overflow-hidden sm:w-56">
        <ClipThumb clip={clip} transitioning={transitioning} />
      </div>
      <div className="flex flex-1 flex-col justify-between gap-4 p-4 sm:p-6">
        <div>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black tracking-wider uppercase ${
              fresh ? "bg-lime text-ink" : "bg-white/10 text-zinc-300"
            }`}
          >
            {fresh && <span className="animate-pulse-dot size-1.5 rounded-full bg-ink" />}
            {fresh ? "Acabou de sair" : "Mais recente"}
          </span>
          <p className="font-display mt-3 text-6xl leading-none font-black tabular-nums italic sm:text-7xl">
            {clip.time_local}
          </p>
          {clip.court_name && (
            <p className="mt-1 text-xs font-bold tracking-wider text-zinc-400 uppercase">
              {clip.court_name}
            </p>
          )}
          <p className="mt-2 text-sm text-zinc-400">Seu lance tá pronto. Assista, baixe e mande pra galera.</p>
        </div>
        <span className="inline-flex items-center justify-center gap-2 self-start rounded-full bg-lime px-5 py-2.5 text-sm font-bold text-ink shadow-[0_10px_30px_-10px_color-mix(in_oklab,var(--color-lime)_70%,transparent)] transition group-hover:brightness-110">
          <Play className="size-4 fill-current" />
          Assistir
        </span>
      </div>
    </Link>
  );
}
