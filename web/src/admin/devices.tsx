import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { adminFetch, ago, errorText, type DeviceEvents, type DeviceEventType, type DeviceRow } from "./api";
import { Badge, Button, Empty, ErrorNote, Field, inputCls, Modal, StatusDot, Table } from "../shared/ui";

function uptime(s?: number): string {
  if (!s) return "—";
  const h = Math.floor(s / 3600);
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${Math.floor((s % 3600) / 60)}m`;
}

/** Apertos que viraram clip enviado; abaixo de 90% no piloto = investigar. */
function ButtonRate({ d }: { d: DeviceRow }) {
  if (!d.press_7d) return <span className="text-zinc-500">—</span>;
  const rate = Math.round((d.clip_ok_7d / d.press_7d) * 100);
  return (
    <span className="tabular-nums">
      <span className={rate >= 90 ? "text-lime" : rate >= 70 ? "text-amber-300" : "text-red-300"}>{rate}%</span>
      <span className="ml-1.5 text-xs text-zinc-500">
        {d.clip_ok_7d}/{d.press_7d}
      </span>
    </span>
  );
}

const EVENT_LABEL: Record<DeviceEventType, string> = {
  press: "Botão apertado",
  clip_ok: "Clip enviado",
  clip_fail: "Clip falhou",
  ffmpeg_restart: "Câmera reiniciada",
  boot: "Agente iniciou",
  queue_drop: "Descartado da fila",
};

const EVENT_TONE: Partial<Record<DeviceEventType, string>> = {
  clip_ok: "text-lime",
  clip_fail: "text-red-300",
  queue_drop: "text-red-300",
  ffmpeg_restart: "text-amber-300",
};

function DeviceEventsModal({ device, onClose }: { device: DeviceRow | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["admin", "device-events", device?.id],
    queryFn: () => adminFetch<DeviceEvents>(`/devices/${device!.id}/events`),
    enabled: Boolean(device),
  });
  return (
    <Modal open={Boolean(device)} onClose={onClose} title={device ? `Eventos · ${device.name}` : ""}>
      {q.isPending ? (
        <p className="text-sm text-zinc-500">Carregando…</p>
      ) : q.error ? (
        <ErrorNote>{errorText(q.error)}</ErrorNote>
      ) : (
        <div className="flex max-h-[60svh] flex-col gap-4 overflow-y-auto">
          {q.data.alerts.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold tracking-wider text-zinc-500 uppercase">Alertas</h3>
              <ul className="flex flex-col gap-1 text-sm">
                {q.data.alerts.map((a) => (
                  <li key={a.id} className="flex justify-between gap-3">
                    <span className={a.resolved_at ? "text-zinc-400" : "text-amber-300"}>{a.detail ?? a.kind}</span>
                    <span className="shrink-0 text-xs text-zinc-500">
                      {ago(a.opened_at)}
                      {a.resolved_at ? ` · resolvido ${ago(a.resolved_at)}` : " · aberto"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section>
            <h3 className="mb-2 text-xs font-semibold tracking-wider text-zinc-500 uppercase">Agente</h3>
            {q.data.events.length ? (
              <ul className="flex flex-col gap-1 text-sm">
                {q.data.events.map((e) => (
                  <li key={e.id} className="flex justify-between gap-3">
                    <span className={EVENT_TONE[e.type] ?? "text-zinc-300"}>
                      {EVENT_LABEL[e.type]}
                      {e.detail && <span className="ml-2 font-mono text-[11px] text-zinc-600">{e.detail}</span>}
                    </span>
                    <span className="shrink-0 text-xs text-zinc-500">{ago(e.created_at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-zinc-500">Nenhum evento ainda (agente ≥ 0.4).</p>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}

export function DeviceTable({ devices, showVenue = false }: { devices: DeviceRow[]; showVenue?: boolean }) {
  const qc = useQueryClient();
  const [eventsOf, setEventsOf] = useState<DeviceRow | null>(null);
  const revoke = useMutation({
    mutationFn: (id: string) => adminFetch(`/devices/${id}/revoke`, "POST"),
    onSuccess: () => qc.invalidateQueries(),
  });

  if (!devices.length) return <Empty>Nenhum dispositivo.</Empty>;

  return (
    <>
      <DeviceEventsModal device={eventsOf} onClose={() => setEventsOf(null)} />
      <Table>
        <thead>
          <tr>
            <th>Dispositivo</th>
            {showVenue && <th>Arena</th>}
            <th>Status</th>
            <th>Botão 7d</th>
            <th>Temp.</th>
            <th>Buffer</th>
            <th>Fila</th>
            <th>Uptime</th>
            <th>Versão</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {devices.map((d) => {
            const p = d.last_payload;
            const revoked = Boolean(d.revoked_at);
            return (
              <tr key={d.id} className={revoked ? "opacity-50" : ""}>
                <td>
                  <p className="font-semibold">{d.name}</p>
                  <p className="font-mono text-[11px] text-zinc-600">{d.id.slice(0, 8)}</p>
                </td>
                {showVenue && (
                  <td>
                    <Link to={`/painel/arenas/${d.venue_id}`} className="hover:text-lime">
                      {d.venue_name}
                    </Link>
                  </td>
                )}
                <td>
                  {revoked ? (
                    <Badge>Revogado</Badge>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <StatusDot online={d.online} />
                      <span className={d.online ? "text-zinc-200" : "text-red-300"}>{d.online ? "Online" : "Offline"}</span>
                      <span className="text-xs text-zinc-500">{ago(d.last_seen_at)}</span>
                    </span>
                  )}
                  {d.issues.map((i) => (
                    <span key={i} className="mt-1 flex items-center gap-1 text-xs text-amber-300">
                      <TriangleAlert className="size-3" /> {i}
                    </span>
                  ))}
                </td>
                <td>
                  <ButtonRate d={d} />
                </td>
                <td className="tabular-nums">{p?.temp_c !== undefined ? `${p.temp_c.toFixed(0)}°C` : "—"}</td>
                <td className="tabular-nums">
                  {p?.buffer_alive === undefined ? "—" : p.buffer_alive ? `${p.segments ?? 0} seg.` : <span className="text-red-300">parado</span>}
                </td>
                <td className="tabular-nums">
                  {p?.queue_len === undefined ? "—" : <span className={p.queue_len > 0 ? "text-amber-300" : ""}>{p.queue_len}</span>}
                </td>
                <td className="tabular-nums">{uptime(p?.uptime_s)}</td>
                <td className="font-mono text-xs">{d.agent_version ?? "—"}</td>
                <td className="text-right whitespace-nowrap">
                  <Button size="sm" variant="ghost" onClick={() => setEventsOf(d)}>
                    Eventos
                  </Button>
                  {!revoked && (
                    <Button
                      size="sm"
                      variant="danger"
                      loading={revoke.isPending && revoke.variables === d.id}
                      onClick={() => {
                        if (confirm(`Revogar "${d.name}"? O Pi para de subir clips até receber um token novo.`)) {
                          revoke.mutate(d.id);
                        }
                      }}
                    >
                      Revogar
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </>
  );
}

/** Cria o Pi e mostra o token UMA vez — o D1 só guarda o hash. */
export function CreateDeviceModal({ venueId, open, onClose }: { venueId: string; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [copied, setCopied] = useState(false);
  const create = useMutation({
    mutationFn: () => adminFetch<{ id: string; token: string }>("/devices", "POST", { venue_id: venueId, name }),
    onSuccess: () => qc.invalidateQueries(),
  });
  const envLine = create.data ? `EDGE_TOKEN=${create.data.token}` : "";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={create.data ? "Token gerado" : "Novo dispositivo"}
      footer={
        create.data ? (
          <Button variant="primary" onClick={onClose}>
            Já copiei
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button variant="primary" loading={create.isPending} disabled={!name.trim()} onClick={() => create.mutate()}>
              Gerar token
            </Button>
          </>
        )
      }
    >
      {create.data ? (
        <div className="flex flex-col gap-3">
          <p className="flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-200">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            Esse token não aparece de novo. Cole no <code className="font-mono">/etc/replay/edge.env</code> do Pi
            (ou <code className="font-mono">edge/.env</code> no PC).
          </p>
          <div className="flex items-center gap-2 rounded-lg border border-line bg-ink p-2">
            <code className="min-w-0 flex-1 truncate font-mono text-xs text-lime">{envLine}</code>
            <Button
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(envLine);
                setCopied(true);
              }}
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? "Copiado" : "Copiar"}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <Field label="Nome" hint="Ex.: Pi quadra 1-3, Pi entrada">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          <div className="mt-3">
            <ErrorNote>{create.error && errorText(create.error)}</ErrorNote>
          </div>
        </>
      )}
    </Modal>
  );
}
