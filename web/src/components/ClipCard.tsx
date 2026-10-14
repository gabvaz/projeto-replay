import { Play } from "lucide-react";
import { useState } from "react";
import { Link, useViewTransitionState } from "react-router";
import { isFresh, type ClipSummary } from "../api";

type Props = {
  clip: ClipSummary;
  isToday: boolean;
  /** Atraso da animação de entrada (ms), pra cascata. */
  delay?: number;
  className?: string;
  /** Morph thumb→player. Desligar quando o player já está na tela (nomes de transição são únicos). */
  morph?: boolean;
};

export function ClipThumb({ clip, transitioning }: { clip: ClipSummary; transitioning: boolean }) {
  const [failed, setFailed] = useState(false);
  const style = transitioning ? { viewTransitionName: "clip-media" } : undefined;
  if (!clip.thumb_url || failed) {
    return (
      <div
        style={style}
        className="flex h-full w-full items-center justify-center bg-gradient-to-br from-surface-2 to-ink"
      >
        <Play className="size-8 text-zinc-700" />
      </div>
    );
  }
  return (
    <img
      src={clip.thumb_url}
      alt={`Replay das ${clip.time_local}`}
      loading="lazy"
      onError={() => setFailed(true)}
      style={style}
      className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
    />
  );
}

export function ClipCard({ clip, isToday, delay = 0, className = "", morph = true }: Props) {
  const to = `/v/${clip.id}`;
  const transitioning = useViewTransitionState(to) && morph;
  const fresh = isFresh(clip.time_local, isToday);

  return (
    <Link
      to={to}
      state={{ thumb: clip.thumb_url }}
      viewTransition
      style={{ animationDelay: `${delay}ms` }}
      className={`group animate-rise-in relative block aspect-[9/16] overflow-hidden rounded-xl bg-surface ring-1 sm:rounded-2xl ring-line transition hover:ring-lime/60 active:scale-[0.98] ${className}`}
    >
      <ClipThumb clip={clip} transitioning={transitioning} />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
      {fresh && (
        <span className="absolute top-2 left-2 rounded-full bg-lime px-2 py-0.5 text-[10px] font-black tracking-wider text-ink uppercase">
          Novo
        </span>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-1 p-2 sm:p-3">
        <span className="font-display text-2xl leading-none font-extrabold tabular-nums sm:text-3xl">
          {clip.time_local}
        </span>
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/15 backdrop-blur transition group-hover:bg-lime group-hover:text-ink sm:size-9">
          <Play className="size-3.5 translate-x-px fill-current sm:size-4" />
        </span>
      </div>
    </Link>
  );
}
