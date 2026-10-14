import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { todayBrt } from "../../shared/format";
import { Badge, Button, Card, Empty, ErrorNote, inputCls, Loading, PageHeader } from "../../shared/ui";
import { errorText, get, portalFetch, type ArenaClip, type Court } from "../api";

export function ClipsPage() {
  const qc = useQueryClient();
  const [date, setDate] = useState(todayBrt());
  const [court, setCourt] = useState("");
  const courts = useQuery({ queryKey: ["courts"], queryFn: () => get<{ courts: Court[] }>("/courts") });
  const q = useQuery({
    queryKey: ["clips", date, court],
    queryFn: () => get<{ clips: ArenaClip[] }>(`/clips?date=${date}${court ? `&court=${court}` : ""}`),
  });
  const del = useMutation({
    mutationFn: (id: string) => portalFetch(`/clips/${id}`, "DELETE"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["clips"] }),
  });

  return (
    <>
      <PageHeader title="Clips" subtitle="Apague um clip se algum jogador pedir (some na hora da galeria)" />
      <div className="mb-4 flex flex-wrap gap-2">
        <input
          type="date"
          className={`${inputCls} w-auto!`}
          value={date}
          max={todayBrt()}
          onChange={(e) => setDate(e.target.value)}
        />
        <select className={`${inputCls} w-auto!`} value={court} onChange={(e) => setCourt(e.target.value)}>
          <option value="">Todas as quadras</option>
          {courts.data?.courts.map((co) => (
            <option key={co.id} value={co.id}>
              {co.name}
            </option>
          ))}
        </select>
      </div>
      <ErrorNote>{del.error && errorText(del.error)}</ErrorNote>

      <Card>
        {!q.data ? (
          <Loading />
        ) : !q.data.clips.length ? (
          <Empty>Nenhum clip nesse dia.</Empty>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {q.data.clips.map((cl) => (
              <li key={cl.id} className="overflow-hidden rounded-xl border border-line bg-ink">
                <a href={`/v/${cl.id}`} target="_blank" rel="noreferrer" className="relative block aspect-video bg-surface-2">
                  {cl.thumb_url && <img src={cl.thumb_url} alt="" loading="lazy" className="size-full object-cover" />}
                  <span className="absolute top-1.5 left-1.5 rounded bg-black/70 px-1.5 py-0.5 text-xs font-bold tabular-nums">
                    {cl.time_local}
                  </span>
                  {cl.status !== "ready" && (
                    <span className="absolute top-1.5 right-1.5">
                      <Badge tone="amber">enviando</Badge>
                    </span>
                  )}
                </a>
                <div className="flex items-center gap-2 px-2.5 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold">{cl.court_name}</p>
                    <p className="text-[11px] text-zinc-500 tabular-nums">
                      {cl.views} views · {cl.downloads} downloads
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Apagar clip"
                    loading={del.isPending && del.variables === cl.id}
                    onClick={() => confirm("Apagar esse clip de vez? Não dá pra desfazer.") && del.mutate(cl.id)}
                  >
                    <Trash2 className="size-3.5 text-red-300" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
