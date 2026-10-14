import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import { Link, useParams } from "react-router";
import { fetchClip, formatExpiry, NotFoundError, sendEvent } from "../api";
import { ShareButton } from "../components/ShareButton";
import { VenueHeader } from "../components/VenueHeader";

export function ClipPage() {
  const { id = "" } = useParams();
  const clip = useQuery({ queryKey: ["clip", id], queryFn: () => fetchClip(id) });
  const viewed = useRef(false);

  if (clip.error instanceof NotFoundError) {
    return (
      <>
        <VenueHeader />
        <div className="px-6 py-20 text-center">
          <p className="text-lg font-semibold">Este replay expirou ou não existe.</p>
          <p className="mt-1 text-zinc-400">Os vídeos ficam disponíveis por 7 dias.</p>
        </div>
      </>
    );
  }

  const c = clip.data;

  return (
    <>
      <VenueHeader venueName={c?.venue_name} courtName={c?.court_name} courtKey={c?.court_key} />
      <main className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-4">
        {c ? (
          <>
            <video
              src={c.play_url}
              poster={c.thumb_url ?? undefined}
              controls
              playsInline
              preload="metadata"
              className="max-h-[75vh] w-full rounded-xl bg-black"
              onPlay={() => {
                if (viewed.current) return;
                viewed.current = true;
                sendEvent(c.id, "view");
              }}
            />
            <p className="text-sm text-zinc-400">
              {c.date_local.split("-").reverse().join("/")} às {c.time_local}
            </p>
            <div className="flex gap-3">
              <a
                href={c.download_url}
                download
                className="flex-1 rounded-xl bg-brand px-4 py-3 text-center text-base font-semibold text-zinc-950 transition hover:brightness-110"
              >
                Baixar
              </a>
              <ShareButton
                clipId={c.id}
                videoUrl={c.play_url}
                title={`Replay · ${c.venue_name} · ${c.court_name}`}
              />
            </div>
            <p className="text-center text-xs text-zinc-500">
              Disponível até {formatExpiry(c.expires_at)}
            </p>
            <Link to={`/q/${c.court_key}`} className="text-center text-sm text-brand underline">
              Ver outros replays da quadra
            </Link>
          </>
        ) : (
          <div className="aspect-video w-full animate-pulse rounded-xl bg-zinc-900" />
        )}
      </main>
    </>
  );
}
