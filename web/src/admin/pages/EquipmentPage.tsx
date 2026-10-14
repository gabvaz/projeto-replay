import { useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { useState } from "react";
import {
  brl,
  EQUIPMENT_KIND_LABEL,
  EQUIPMENT_STATUS_LABEL,
  get,
  num,
  type EquipmentKind,
  type EquipmentRow,
  type EquipmentStatus,
} from "../api";
import { EquipmentModal, EquipmentTable, equipmentTotal } from "../equipment";
import { Button, Card, inputCls, Kpi, Loading, PageHeader } from "../ui";

export function EquipmentPage() {
  const q = useQuery({ queryKey: ["equipment"], queryFn: () => get<{ equipment: EquipmentRow[] }>("/equipment") });
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState<EquipmentStatus | "">("");
  const [kind, setKind] = useState<EquipmentKind | "">("");
  const [search, setSearch] = useState("");

  const all = q.data?.equipment ?? [];
  const term = search.trim().toLowerCase();
  const items = all.filter(
    (e) =>
      (!status || e.status === status) &&
      (!kind || e.kind === kind) &&
      (!term || `${e.model ?? ""} ${e.serial ?? ""} ${e.venue_name ?? ""}`.toLowerCase().includes(term)),
  );
  const by = (s: EquipmentStatus) => all.filter((e) => e.status === s);

  return (
    <>
      <PageHeader
        title="Equipamentos"
        subtitle="Inventário em comodato"
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> Equipamento
          </Button>
        }
      />

      {!q.data ? (
        <Loading />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Instalados" value={num(by("installed").length)} hint={brl(equipmentTotal(by("installed")))} tone="lime" />
            <Kpi label="Em estoque" value={num(by("stock").length)} hint={brl(equipmentTotal(by("stock")))} />
            <Kpi
              label="Manutenção"
              value={num(by("maintenance").length)}
              tone={by("maintenance").length ? "amber" : undefined}
            />
            <Kpi
              label="Patrimônio"
              value={brl(equipmentTotal(all.filter((e) => e.status !== "retired" && e.status !== "lost")))}
              hint={`${num(by("lost").length)} perdidos · ${num(by("retired").length)} baixados`}
            />
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            <div className="relative min-w-48 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-600" />
              <input
                className={`${inputCls} pl-9`}
                placeholder="Modelo, série ou arena"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select className={`${inputCls} w-auto!`} value={kind} onChange={(e) => setKind(e.target.value as EquipmentKind | "")}>
              <option value="">Todos os tipos</option>
              {Object.entries(EQUIPMENT_KIND_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            <select
              className={`${inputCls} w-auto!`}
              value={status}
              onChange={(e) => setStatus(e.target.value as EquipmentStatus | "")}
            >
              <option value="">Todos os status</option>
              {Object.entries(EQUIPMENT_STATUS_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </div>

          <Card pad={false}>
            <EquipmentTable items={items} />
          </Card>
        </>
      )}

      {creating && <EquipmentModal onClose={() => setCreating(false)} />}
    </>
  );
}
