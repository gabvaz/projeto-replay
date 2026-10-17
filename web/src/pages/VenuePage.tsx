import { useQuery } from "@tanstack/react-query";
import { SearchX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { fetchVenue, fetchVenueClips, NotFoundError, type ClipSummary } from "../api";
import { AppHeader } from "../components/AppHeader";
import { CourtHero } from "../components/CourtHero";
import { DayPicker } from "../components/DayPicker";
import { EmptyState } from "../components/EmptyState";
import { FeaturedClip } from "../components/FeaturedClip";
import { HourGroup } from "../components/HourGroup";
import { Logo } from "../components/Logo";
import { GallerySkeleton } from "../components/Skeletons";
import { Toast } from "../components/Toast";
import { BrandScope } from "../shared/brand";

const POLL_MS = 15_000;
const TOAST_MS = 4_000;

function groupByHour(clips: ClipSummary[]): { hour: number; clips: ClipSummary[] }[] {
  const groups = new Map<number, ClipSummary[]>();
  for (const clip of clips) {
    const list = groups.get(clip.hour) ?? [];
    list.push(clip);
    groups.set(clip.hour, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => b - a)
    .map(([hour, list]) => ({ hour, clips: list }));
}

function useNewClipToast(clips: ClipSummary[] | undefined, date: string | undefined) {
  const seen = useRef<{ date?: string; ids: Set<string> } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!clips) return;
    const ids = new Set(clips.map((c) => c.id));
    const prev = seen.current;
    seen.current = { date, ids };
    if (!prev || prev.date !== date) return;
    const fresh = clips.filter((c) => !prev.ids.has(c.id)).length;
    if (fresh === 0) return;
    setMessage(fresh === 1 ? "Novo replay chegou!" : `${fresh} replays novos!`);
    const t = setTimeout(() => setMessage(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [clips, date]);

  return [message, () => setMessage(null)] as const;
}

function CourtFilter({
  courts,
  value,
  onChange,
}: {
  courts: { key: string; name: string }[];
  value: string | null;
  onChange: (key: string | null) => void;
}) {
  if (courts.length <= 1) return null;
  return (
    <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
      <button
        type="button"
        onClick={() => onChange(null)}
        className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold tracking-wide uppercase transition ${
          !value
            ? "bg-lime text-ink"
            : "border border-line bg-surface text-zinc-300 hover:border-lime/40"
        }`}
      >
        Todas
      </button>
      {courts.map((co) => (
        <button
          key={co.key}
          type="button"
          onClick={() => onChange(co.key)}
          className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold tracking-wide uppercase transition ${
            value === co.key
              ? "bg-lime text-ink"
              : "border border-line bg-surface text-zinc-300 hover:border-lime/40"
          }`}
        >
          {co.name}
        </button>
      ))}
    </div>
  );
}

export function VenuePage() {
  const { key = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const courtFilter = params.get("court");

  const venue = useQuery({ queryKey: ["venue", key], queryFn: () => fetchVenue(key) });
  const today = venue.data?.today;
  const date = params.get("d") ?? today;
  const isToday = date === today;

  const clips = useQuery({
    queryKey: ["venue-clips", key, date, courtFilter],
    queryFn: () => fetchVenueClips(key, date!, courtFilter),
    enabled: Boolean(date),
    refetchInterval: isToday ? POLL_MS : false,
  });

  const [toast, dismissToast] = useNewClipToast(clips.data?.clips, date);

  function patchParams(next: { d?: string | null; court?: string | null }) {
    const p = new URLSearchParams(params);
    if ("d" in next) {
      if (!next.d || next.d === today) p.delete("d");
      else p.set("d", next.d);
    }
    if ("court" in next) {
      if (!next.court) p.delete("court");
      else p.set("court", next.court);
    }
    setParams(p, { replace: true });
  }

  if (venue.error instanceof NotFoundError) {
    return (
      <>
        <AppHeader />
        <main className="animate-rise-in mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-20 text-center">
          <SearchX className="size-12 text-zinc-600" />
          <h1 className="font-display text-4xl leading-none font-black uppercase italic">
            Arena não encontrada
          </h1>
          <p className="text-zinc-400">
            Confira o código <span className="font-mono text-zinc-200">{key}</span>.
          </p>
          <Link to="/" className="mt-2 rounded-full bg-lime px-5 py-2.5 text-sm font-bold text-ink">
            Voltar ao início
          </Link>
        </main>
      </>
    );
  }

  const list = clips.data?.clips ?? [];
  const featured = isToday ? list[0] : undefined;
  const groups = groupByHour(featured ? list.slice(1) : list);
  const courts = venue.data?.courts ?? [];
  const selectedCourt = courts.find((c) => c.key === courtFilter);

  return (
    <BrandScope color={venue.data?.brand?.color}>
      <AppHeader />
      <Toast
        message={toast}
        onClick={() => {
          dismissToast();
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
      />
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 pb-10">
        <CourtHero
          venueName={
            venue.data
              ? selectedCourt
                ? venue.data.name
                : "Todas as quadras"
              : undefined
          }
          venueHref={selectedCourt ? `/g/${key}` : null}
          courtName={selectedCourt?.name ?? venue.data?.name}
          brand={venue.data?.brand}
          isToday={isToday}
          count={clips.data ? list.length : undefined}
        />

        <CourtFilter
          courts={courts}
          value={courtFilter}
          onChange={(court) => patchParams({ court })}
        />

        {today && (
          <DayPicker
            today={today}
            days={venue.data?.retention_days ?? 7}
            value={date!}
            onChange={(d) => patchParams({ d })}
          />
        )}

        {clips.isPending && <GallerySkeleton />}

        {clips.data && list.length === 0 && <EmptyState isToday={isToday} />}

        {featured && <FeaturedClip key={featured.id} clip={featured} />}

        {groups.map((g) => (
          <HourGroup key={g.hour} hour={g.hour} clips={g.clips} isToday={isToday} />
        ))}

        <footer className="mt-6 flex flex-col items-center gap-2 text-center text-xs text-zinc-600">
          <Logo iconOnly className="opacity-50" />
          {isToday && clips.data
            ? "Atualiza sozinho a cada 15s"
            : `Vídeos ficam disponíveis por ${venue.data?.retention_days ?? 7} dias`}
        </footer>
      </main>
    </BrandScope>
  );
}
