import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { adminFetch, ago, errorText, type DeviceRow } from "./api";
import { Badge, Button, Empty, ErrorNote, Field, inputCls, Modal, StatusDot, Table } from "../shared/ui";

function uptime(s?: number): string {
  if (!s) return "—";
  const h = Math.floor(s / 3600);
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${Math.floor((s % 3600) / 60)}m`;
}

export function DeviceTable({ devices, showVenue = false }: { devices: DeviceRow[]; showVenue?: boolean }) {
  const qc = useQueryClient();
  const revoke = useMutation({
    mutationFn: (id: string) => adminFetch(`/devices/${id}/revoke`, "POST"),
    onSuccess: () => qc.invalidateQueries(),
  });

  if (!devices.length) return <Empty>Nenhum dispositivo.</Empty>;

  return (
    <Table>
      <thead>
        <tr>
          <th>Dispositivo</th>
          {showVenue && <th>Arena</th>}
          <th>Status</th>
          <th>Temp.</th>
          <th>Buffer</th>
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
              <td className="tabular-nums">{p?.temp_c !== undefined ? `${p.temp_c.toFixed(0)}°C` : "—"}</td>
              <td className="tabular-nums">
                {p?.buffer_alive === undefined ? "—" : p.buffer_alive ? `${p.segments ?? 0} seg.` : <span className="text-red-300">parado</span>}
              </td>
              <td className="tabular-nums">{uptime(p?.uptime_s)}</td>
              <td className="font-mono text-xs">{d.agent_version ?? "—"}</td>
              <td className="text-right">
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
            Esse token não aparece de novo. Cole no <code className="font-mono">edge/.env</code> do Pi.
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
