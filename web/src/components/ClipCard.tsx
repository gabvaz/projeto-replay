import { useState } from "react";
import { Link } from "react-router";
import type { ClipSummary } from "../api";

export function ClipCard({ clip }: { clip: ClipSummary }) {
  const [thumbFailed, setThumbFailed] = useState(false);
  return (
    <Link
      to={`/v/${clip.id}`}
      className="group block overflow-hidden rounded-xl bg-zinc-900 ring-1 ring-zinc-800 transition hover:ring-brand"
    >
      <div className="relative aspect-video bg-zinc-800">
        {clip.thumb_url && !thumbFailed ? (
          <img
            src={clip.thumb_url}
            alt={`Replay das ${clip.time_local}`}
            loading="lazy"
            onError={() => setThumbFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-3xl text-zinc-600">▶</div>
        )}
        <span className="absolute bottom-1.5 left-1.5 rounded-md bg-black/70 px-2 py-0.5 text-sm font-semibold tabular-nums">
          {clip.time_local}
        </span>
      </div>
    </Link>
  );
}
