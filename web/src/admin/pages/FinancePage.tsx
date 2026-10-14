import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { brl, get, type Invoice, type Overview } from "../api";
import { InvoiceTable } from "../invoices";
import { Card, Kpi, Loading, PageHeader, Tabs } from "../../shared/ui";

type Filter = "open" | "overdue" | "paid" | "void" | "all";

export function FinancePage() {
  const [filter, setFilter] = useState<Filter>("open");
  const overview = useQuery({ queryKey: ["overview"], queryFn: () => get<Overview>("/overview") });
  const q = useQuery({
    queryKey: ["invoices", filter],
    queryFn: () => get<{ invoices: Invoice[] }>(filter === "all" ? "/invoices" : `/invoices?status=${filter}`),
  });
  const f = overview.data?.finance;
  const toReceive = f ? Math.max(0, f.due_month_cents - f.paid_month_cents) : 0;

  return (
    <>
      <PageHeader title="Financeiro" subtitle="Mensalidades geradas todo mês a partir dos contratos" />

      {f ? (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="MRR" value={brl(f.mrr_cents)} tone="lime" hint={`${f.contracts} contratos ativos`} />
          <Kpi label="Recebido no mês" value={brl(f.paid_month_cents)} hint={`de ${brl(f.due_month_cents)} faturados`} />
          <Kpi label="A receber" value={brl(f.open_cents)} hint={`${brl(toReceive)} ainda deste mês`} />
          <Kpi
            label="Em atraso"
            value={brl(f.overdue_cents)}
            tone={f.overdue_count ? "red" : undefined}
            hint={`${f.overdue_count} fatura(s)`}
          />
        </div>
      ) : (
        <Loading />
      )}

      <Tabs<Filter>
        value={filter}
        onChange={setFilter}
        tabs={[
          { id: "open", label: "Em aberto" },
          { id: "overdue", label: "Atrasadas", count: f?.overdue_count },
          { id: "paid", label: "Pagas" },
          { id: "void", label: "Anuladas" },
          { id: "all", label: "Todas" },
        ]}
      />

      <Card pad={false}>{q.data ? <InvoiceTable invoices={q.data.invoices} showVenue /> : <Loading />}</Card>
    </>
  );
}
