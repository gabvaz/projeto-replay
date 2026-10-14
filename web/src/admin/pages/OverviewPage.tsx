import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Flame, WifiOff, Wallet } from "lucide-react";
import { Link } from "react-router";
import { ago, brl, dateBr, get, num, periodLabel, type Alert, type Overview } from "../api";
import { DailyChart } from "../charts";
import { Card, Empty, Kpi, Loading, PageHeader, Table } from "../ui";

function AlertItem({ alert }: { alert: Alert }) {
  const base = "flex items-start gap-3 px-4 py-3";
  const venue = (
    <Link to={`/painel/arenas/${alert.venue_id}`} className="font-semibold text-white hover:text-lime">
      {alert.venue_name}
    </Link>
  );
  if (alert.kind === "device_offline") {
    return (
      <li className={base}>
        <WifiOff className="mt-0.5 size-4 shrink-0 text-red-400" />
        <p className="text-sm text-zinc-300">
          {venue} · <span className="font-medium">{alert.device}</span> offline{" "}
          <span className="text-zinc-500">({ago(alert.since)})</span>
        </p>
      </li>
    );
  }
  if (alert.kind === "device_health") {
    return (
      <li className={base}>
        <Flame className="mt-0.5 size-4 shrink-0 text-amber-400" />
        <p className="text-sm text-zinc-300">
          {venue} · <span className="font-medium">{alert.device}</span>: {alert.detail}
        </p>
      </li>
    );
  }
  return (
    <li className={base}>
      <Wallet className="mt-0.5 size-4 shrink-0 text-amber-400" />
      <p className="text-sm text-zinc-300">
        {venue} · fatura {periodLabel(alert.period)} de {brl(alert.amount_cents)} vencida em {dateBr(alert.due_date)}
      </p>
    </li>
  );
}

export function OverviewPage() {
  const q = useQuery({
    queryKey: ["overview"],
    queryFn: () => get<Overview>("/overview"),
    refetchOnWindowFocus: false,
  });
  if (!q.data) return <Loading />;
  const o = q.data;
  const toReceive = Math.max(0, Number(o.finance.due_month_cents) - Number(o.finance.paid_month_cents));

  return (
    <>
      <PageHeader title="Visão geral" subtitle={`Hoje, ${dateBr(o.today)}`} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label="Arenas ativas"
          value={num(o.venues.active)}
          hint={`${num(o.venues.onboarding)} em implantação`}
        />
        <Kpi
          label="Pis online"
          value={`${o.devices.online}/${o.devices.total}`}
          tone={o.devices.online < o.devices.total ? "red" : "lime"}
          hint={o.devices.total - o.devices.online ? `${o.devices.total - o.devices.online} offline` : "tudo no ar"}
        />
        <Kpi label="Clips hoje" value={num(o.clips.today)} hint={`${num(o.clips.d7)} em 7d · ${num(o.clips.d30)} em 30d`} />
        <Kpi
          label="Views 30d"
          value={num(o.engagement30.views)}
          hint={`${num(o.engagement30.downloads)} downloads · ${num(o.engagement30.shares)} shares`}
        />
        <Kpi label="MRR" value={brl(o.finance.mrr_cents)} tone="lime" hint={`${o.finance.contracts} contratos ativos`} />
        <Kpi
          label="Em atraso"
          value={brl(o.finance.overdue_cents)}
          tone={o.finance.overdue_count ? "red" : undefined}
          hint={`${o.finance.overdue_count} faturas · ${brl(toReceive)} a receber no mês`}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Uso diário" className="lg:col-span-2">
          <DailyChart series={o.series} today={o.today} />
          <p className="mt-3 text-xs text-zinc-500">
            {num(o.engagement30.unique_daily_visitors)} visitas únicas em 30 dias (1 pessoa por dia).
          </p>
        </Card>

        <Card
          title={
            <span className="inline-flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-400" /> Alertas
            </span>
          }
          pad={false}
        >
          {o.alerts.length ? (
            <ul className="max-h-80 divide-y divide-line overflow-y-auto">
              {o.alerts.map((a, i) => (
                <AlertItem key={i} alert={a} />
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center gap-2 py-10 text-sm text-zinc-500">
              <CheckCircle2 className="size-6 text-lime" />
              Nada pegando fogo.
            </div>
          )}
        </Card>
      </div>

      <Card title="Arenas mais ativas (30 dias)" className="mt-4" pad={false}>
        {o.top_venues.length ? (
          <Table>
            <thead>
              <tr>
                <th>Arena</th>
                <th className="text-right">Clips</th>
                <th className="text-right">Views</th>
                <th className="text-right">Downloads</th>
                <th className="text-right">Shares</th>
                <th className="text-right">Views/clip</th>
              </tr>
            </thead>
            <tbody>
              {o.top_venues.map((v) => (
                <tr key={v.venue_id}>
                  <td>
                    <Link to={`/painel/arenas/${v.venue_id}`} className="font-semibold hover:text-lime">
                      {v.venue_name}
                    </Link>
                  </td>
                  <td className="text-right tabular-nums">{num(v.clips)}</td>
                  <td className="text-right tabular-nums">{num(v.views)}</td>
                  <td className="text-right tabular-nums">{num(v.downloads)}</td>
                  <td className="text-right tabular-nums">{num(v.shares)}</td>
                  <td className="text-right text-zinc-400 tabular-nums">
                    {v.clips ? (v.views / v.clips).toFixed(1) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty>Sem uso nos últimos 30 dias.</Empty>
        )}
      </Card>
    </>
  );
}
