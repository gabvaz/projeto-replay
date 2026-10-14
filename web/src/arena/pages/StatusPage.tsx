import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, WifiOff } from "lucide-react";
import { ago, num } from "../../shared/format";
import { Card, Empty, Loading, PageHeader, StatusDot } from "../../shared/ui";
import { get, type StatusData } from "../api";

/** Quadra sem clip há 2 dias costuma ser câmera/botão com problema. */
const STALE_MS = 2 * 24 * 3600_000;
const stale = (utc: string | null) => !utc || Date.now() - Date.parse(`${utc.replace(" ", "T")}Z`) > STALE_MS;

export function StatusPage() {
  const q = useQuery({ queryKey: ["status"], queryFn: () => get<StatusData>("/devices") });
  if (!q.data) return <Loading />;
  const { devices, courts } = q.data;
  const offline = devices.filter((d) => !d.online);

  return (
    <>
      <PageHeader title="Status" subtitle="Se algo estiver offline, chama a gente que resolvemos" />
      <div
        className={`mb-4 flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm ${
          offline.length ? "border-red-500/30 bg-red-500/10 text-red-200" : "border-lime/30 bg-lime/10 text-zinc-200"
        }`}
      >
        {offline.length ? (
          <WifiOff className="size-5 shrink-0 text-red-300" />
        ) : (
          <CheckCircle2 className="size-5 shrink-0 text-lime" />
        )}
        {offline.length
          ? `${offline.length} equipamento(s) sem conexão agora.`
          : devices.length
            ? "Tudo no ar. As câmeras estão gravando."
            : "Nenhum equipamento instalado ainda."}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Equipamentos" pad={false}>
          {devices.length ? (
            <ul className="divide-y divide-line">
              {devices.map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                  <StatusDot online={d.online} />
                  <span className="flex-1 font-semibold">{d.name}</span>
                  <span className={`text-xs ${d.online ? "text-zinc-400" : "text-red-300"}`}>
                    {d.online ? "online" : `offline · visto ${ago(d.last_seen_at)}`}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Nada instalado.</Empty>
          )}
        </Card>
        <Card title="Último clip por quadra" pad={false}>
          {courts.length ? (
            <ul className="divide-y divide-line">
              {courts.map((co) => (
                <li key={co.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="flex-1 font-semibold">{co.name}</span>
                  <span className={`text-xs tabular-nums ${stale(co.last_clip_at) ? "text-amber-300" : "text-zinc-400"}`}>
                    {ago(co.last_clip_at)} · {num(co.clips_7d)} em 7d
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Nenhuma quadra.</Empty>
          )}
        </Card>
      </div>
    </>
  );
}
