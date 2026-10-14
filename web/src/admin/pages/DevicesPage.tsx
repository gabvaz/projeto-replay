import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { get, type DeviceRow } from "../api";
import { DeviceTable } from "../devices";
import { Card, Kpi, Loading, PageHeader, Tabs } from "../../shared/ui";

type Filter = "all" | "offline" | "issues" | "revoked";

export function DevicesPage() {
  const q = useQuery({
    queryKey: ["devices"],
    queryFn: () => get<{ devices: DeviceRow[] }>("/devices"),
    refetchInterval: 30_000,
  });
  const [filter, setFilter] = useState<Filter>("all");

  if (!q.data) return <Loading />;
  const all = q.data.devices;
  const active = all.filter((d) => !d.revoked_at);
  const offline = active.filter((d) => !d.online);
  const issues = active.filter((d) => d.issues.length);
  const revoked = all.filter((d) => d.revoked_at);
  const list = { all: active, offline, issues, revoked }[filter];
  const versions = new Set(active.map((d) => d.agent_version).filter(Boolean));

  return (
    <>
      <PageHeader title="Dispositivos" subtitle="Saúde dos Pi em campo · atualiza a cada 30s" />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Online" value={`${active.length - offline.length}/${active.length}`} tone={offline.length ? "red" : "lime"} />
        <Kpi label="Com alerta" value={issues.length} tone={issues.length ? "amber" : undefined} hint="temp., throttling, buffer" />
        <Kpi
          label="Versões"
          value={versions.size}
          tone={versions.size > 1 ? "amber" : undefined}
          hint={[...versions].join(", ") || "—"}
        />
        <Kpi label="Revogados" value={revoked.length} />
      </div>

      <Tabs<Filter>
        value={filter}
        onChange={setFilter}
        tabs={[
          { id: "all", label: "Ativos", count: active.length },
          { id: "offline", label: "Offline", count: offline.length },
          { id: "issues", label: "Com alerta", count: issues.length },
          { id: "revoked", label: "Revogados", count: revoked.length },
        ]}
      />
      <Card pad={false}>
        <DeviceTable devices={list} showVenue />
      </Card>
    </>
  );
}
