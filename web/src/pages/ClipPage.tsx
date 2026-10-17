import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Clock, Download, Film, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import {
  expiryLabel,
  fetchClip,
  fetchClips,
  NotFoundError,
  sendEvent,
  shortDate,
  todayBrt,
  type ClipDetail,
} from "../api";
import { AppHeader } from "../components/AppHeader";
import { ClipCard } from "../components/ClipCard";
import { ShareButton } from "../components/ShareButton";
import { BrandLogo, BrandScope } from "../shared/brand";

type NavState = { thumb?: string | null } | null;

function Player({ clip, placeholder }: { clip?: ClipDetail; placeholder?: string | null }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const viewed = useRef(false);
  const [started, setStarted] = useState(false);
  const poster = clip?.thumb_url ?? placeholder ?? undefined;

  return (
    <div
      style={{ viewTransitionName: "clip-media" }}
      className="relative mx-auto aspect-[9/16] max-h-[78svh] w-full max-w-[44svh] overflow-hidden rounded-3xl bg-black shadow-[0_30px_80px_-30px_color-mix(in_oklab,var(--color-lime)_35%,transparent)] ring-1 ring-line"
    >
      {clip ? (
        <video
          ref={videoRef}
          src={clip.play_url}
          poster={poster}
          controls={started}
          playsInline
          preload="metadata"
          className="h-full w-full object-contain"
          onPlay={() => {
            setStarted(true);
            if (viewed.current) return;
            viewed.current = true;
            sendEvent(clip.id, "view");
          }}
        />
      ) : poster ? (
        <img src={poster} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="skeleton h-full w-full" />
      )}

      {!started && (
        <button
          type="button"
          disabled={!clip}
          onClick={() => void videoRef.current?.play()}
          aria-label="Assistir replay"
          className="group absolute inset-0 flex items-center justify-center bg-gradient-to-t from-black/60 via-transparent to-black/20"
        >
          <span className="flex size-20 items-center justify-center rounded-full bg-lime text-ink shadow-[0_0_0_10px_color-mix(in_oklab,var(--color-lime)_18%,transparent),0_20px_50px_-10px_color-mix(in_oklab,var(--color-lime)_70%,transparent)] transition group-hover:scale-105 group-active:scale-95 group-disabled:opacity-60">
            <Play className="size-8 translate-x-0.5 fill-current" />
          </span>
        </button>
      )}
    </div>
  );
}

function MoreFromCourt({ clip }: { clip: ClipDetail }) {
  const more = useQuery({
    queryKey: ["clips", clip.court_key, clip.date_local],
    queryFn: () => fetchClips(clip.court_key, clip.date_local),
  });
  const others = (more.data?.clips ?? []).filter((c) => c.id !== clip.id);
  if (others.length === 0) return null;
  const isToday = clip.date_local === todayBrt();

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-end justify-between">
        <h2 className="font-display text-3xl leading-none font-black uppercase italic">
          Mais da quadra
        </h2>
        <Link
          to={`/q/${clip.court_key}${isToday ? "" : `?d=${clip.date_local}`}`}
          viewTransition
          className="text-sm font-semibold text-lime hover:underline"
        >
          Ver todos
        </Link>
      </div>
      <div className="no-scrollbar -mx-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-1">
        {others.slice(0, 12).map((c, i) => (
          <ClipCard
            key={c.id}
            clip={c}
            isToday={isToday}
            delay={i * 40}
            morph={false}
            className="w-28 shrink-0 snap-start sm:w-32"
          />
        ))}
      </div>
    </section>
  );
}

function ClipView({ id }: { id: string }) {
  const nav = useLocation().state as NavState;
  const clip = useQuery({ queryKey: ["clip", id], queryFn: () => fetchClip(id) });

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  if (clip.error instanceof NotFoundError) {
    return (
      <>
        <AppHeader />
        <main className="animate-rise-in mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-20 text-center">
          <div className="flex size-20 items-center justify-center rounded-full bg-surface ring-1 ring-line">
            <Film className="size-9 text-zinc-600" />
          </div>
          <h1 className="font-display text-4xl leading-none font-black uppercase italic">
            Esse replay expirou
          </h1>
          <p className="text-zinc-400">
            Os vídeos ficam disponíveis por 7 dias. Na próxima, baixe ou compartilhe logo depois do
            jogo.
          </p>
          <Link to="/" className="mt-2 rounded-full bg-lime px-5 py-2.5 text-sm font-bold text-ink">
            Ir para o início
          </Link>
        </main>
      </>
    );
  }

  const c = clip.data;

  return (
    <BrandScope color={c?.brand?.color}>
      <AppHeader backTo={c ? `/q/${c.court_key}` : undefined} backLabel={c?.court_name} />
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 pt-1 pb-[calc(6.5rem+env(safe-area-inset-bottom))]">
        <Player clip={c} placeholder={nav?.thumb} />

        <div className="animate-rise-in flex flex-col items-center gap-2 text-center">
          {c ? (
            <>
              <p className="flex items-center gap-2 text-xs font-semibold tracking-[0.18em] text-zinc-400 uppercase">
                <BrandLogo brand={c.brand} className="size-7" />
                {c.venue_key ? (
                  <Link to={`/g/${c.venue_key}`} viewTransition className="hover:text-lime">
                    {c.venue_name}
                  </Link>
                ) : (
                  c.venue_name
                )}{" "}
                ·{" "}
                <Link to={`/q/${c.court_key}`} viewTransition className="hover:text-lime">
                  {c.court_name}
                </Link>
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 font-semibold">
                  <Clock className="size-3.5 text-lime" />
                  {shortDate(c.date_local)} às {c.time_local}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-zinc-400">
                  <CalendarClock className="size-3.5" />
                  {expiryLabel(c.expires_at)}
                </span>
              </div>
            </>
          ) : (
            <div className="skeleton h-5 w-56 rounded-md" />
          )}
        </div>

        {c && <MoreFromCourt clip={c} />}
      </main>

      {c && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-ink/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
          <div className="mx-auto flex max-w-3xl gap-3 px-4 py-3">
            <a
              href={c.download_url}
              download
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-lime px-4 py-3.5 text-base font-bold text-ink shadow-[0_10px_30px_-10px_color-mix(in_oklab,var(--color-lime)_70%,transparent)] transition hover:brightness-110 active:scale-[0.98]"
            >
              <Download className="size-5" />
              Baixar
            </a>
            <ShareButton
              clipId={c.id}
              videoUrl={c.play_url}
              title={`Replay · ${c.venue_name} · ${c.court_name}`}
            />
          </div>
        </div>
      )}
    </BrandScope>
  );
}

export function ClipPage() {
  const { id = "" } = useParams();
  return <ClipView key={id} id={id} />;
}
