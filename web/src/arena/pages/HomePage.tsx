import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { DailyChart, Heatmap } from "../../shared/charts";
import { num } from "../../shared/format";
import { Card, Empty, Kpi, Loading, PageHeader, Table } from "../../shared/ui";
import { get, type ArenaOverview } from "../api";

const PERIODS = [7, 30, 90] as const;

export function HomePage() {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const q = useQuery({
    queryKey: ["overview", days],
    queryFn: () => get<ArenaOverview>(`/overview?days=${days}`),
  });
  const o = q.data;
  const t = o?.totals ?? {};
  const perClip = t.created ? ((t.view ?? 0) / t.created).toFixed(1) : null;

  return (
    <>
      <PageHeader
        title="Início"
        subtitle="Como os jogadores estão usando o replay"
        actions={
          <div className="flex rounded-lg border border-line bg-surface p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setDays(p)}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
                  p === days ? "bg-lime text-ink" : "text-zinc-400 hover:text-white"
                }`}
              >
                {p}d
              </button>
            ))}
          </div>
        }
      />

      {!o ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Clips" value={num(t.created)} hint={`últimos ${days} dias`} tone="lime" />
            <Kpi label="Views" value={num(t.view)} hint={perClip ? `${perClip} por clip` : undefined} />
            <Kpi label="Downloads" value={num(t.download)} hint={`${num(t.share)} compartilhamentos`} />
            <Kpi label="Jogadores" value={num(o.unique_daily_visitors)} hint="visitas únicas por dia" />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card title="Por dia">
              <DailyChart series={o.series} today={o.today} days={days} />
            </Card>
            <Card title="Horários de pico">
              <Heatmap cells={o.heatmap} />
            </Card>
          </div>

          <Card title="Quadras" className="mt-4" pad={false}>
            {o.courts.length ? (
              <Table>
                <thead>
                  <tr>
                    <th>Quadra</th>
                    <th className="text-right">Clips</th>
                    <th className="text-right">Views</th>
                    <th className="text-right">Downloads</th>
                    <th className="text-right">Views/clip</th>
                  </tr>
                </thead>
                <tbody>
                  {o.courts.map((co) => (
                    <tr key={co.id}>
                      <td className="font-semibold">{co.name}</td>
                      <td className="text-right tabular-nums">{num(co.clips)}</td>
                      <td className="text-right tabular-nums">{num(co.views)}</td>
                      <td className="text-right tabular-nums">{num(co.downloads)}</td>
                      <td className="text-right text-zinc-400 tabular-nums">
                        {co.clips ? (co.views / co.clips).toFixed(1) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <Empty>Nenhuma quadra cadastrada ainda.</Empty>
            )}
          </Card>
        </>
      )}
    </>
  );
}
