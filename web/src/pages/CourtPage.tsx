import { useQuery } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router";
import { fetchClips, fetchCourt, NotFoundError, type ClipSummary } from "../api";
import { DayPicker } from "../components/DayPicker";
import { HourGroup } from "../components/HourGroup";
import { VenueHeader } from "../components/VenueHeader";

const POLL_MS = 15_000;

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

export function CourtPage() {
  const { key = "" } = useParams();
  const [params, setParams] = useSearchParams();

  const court = useQuery({ queryKey: ["court", key], queryFn: () => fetchCourt(key) });
  const today = court.data?.today;
  const date = params.get("d") ?? today;
  const isToday = date === today;

  const clips = useQuery({
    queryKey: ["clips", key, date],
    queryFn: () => fetchClips(key, date!),
    enabled: Boolean(date),
    refetchInterval: isToday ? POLL_MS : false,
  });

  if (court.error instanceof NotFoundError) {
    return (
      <>
        <VenueHeader />
        <p className="px-6 py-20 text-center text-zinc-400">Quadra não encontrada.</p>
      </>
    );
  }

  const groups = groupByHour(clips.data?.clips ?? []);

  return (
    <>
      <VenueHeader venueName={court.data?.venue_name} courtName={court.data?.name} />
      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-4">
        {today && (
          <DayPicker
            today={today}
            days={court.data?.retention_days ?? 7}
            value={date!}
            onChange={(d) => setParams(d === today ? {} : { d }, { replace: true })}
          />
        )}

        {clips.isPending && <p className="py-10 text-center text-zinc-500">Carregando…</p>}

        {clips.data && groups.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-lg font-semibold">Nenhum replay {isToday ? "ainda" : "neste dia"}.</p>
            {isToday && (
              <p className="mt-1 text-zinc-400">Aperte o botão na quadra — o vídeo aparece aqui em segundos.</p>
            )}
          </div>
        )}

        {groups.map((g) => (
          <HourGroup key={g.hour} hour={g.hour} clips={g.clips} />
        ))}

        {isToday && clips.data && (
          <p className="pb-6 text-center text-xs text-zinc-600">Atualiza sozinho a cada 15s</p>
        )}
      </main>
    </>
  );
}
