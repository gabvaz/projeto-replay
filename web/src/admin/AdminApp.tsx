import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router";
import { UnauthorizedError } from "./api";
import { AdminLayout } from "./AdminLayout";
import { DevicesPage } from "./pages/DevicesPage";
import { EquipmentPage } from "./pages/EquipmentPage";
import { FinancePage } from "./pages/FinancePage";
import { LoginPage } from "./pages/LoginPage";
import { OverviewPage } from "./pages/OverviewPage";
import { VenueDetailPage } from "./pages/VenueDetailPage";
import { VenuesPage } from "./pages/VenuesPage";

function toLogin(err: unknown) {
  if (err instanceof UnauthorizedError && !location.pathname.startsWith("/painel/login")) {
    location.assign(`/painel/login?next=${encodeURIComponent(location.pathname + location.search)}`);
  }
}

function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    const prevTitle = document.title;
    document.title = "Replay · Painel";
    return () => {
      meta.remove();
      document.title = prevTitle;
    };
  }, []);
}

/** Painel interno. Chunk separado (lazy no main.tsx) e QueryClient próprio. */
export default function AdminApp() {
  useNoIndex();
  const [client] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({ onError: toLogin }),
        mutationCache: new MutationCache({ onError: toLogin }),
        defaultOptions: {
          queries: {
            retry: (count, err) => !(err instanceof UnauthorizedError) && count < 1,
            staleTime: 15_000,
            refetchOnWindowFocus: true,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <Routes>
        <Route path="login" element={<LoginPage />} />
        <Route element={<AdminLayout />}>
          <Route index element={<OverviewPage />} />
          <Route path="arenas" element={<VenuesPage />} />
          <Route path="arenas/:id" element={<VenueDetailPage />} />
          <Route path="equipamentos" element={<EquipmentPage />} />
          <Route path="financeiro" element={<FinancePage />} />
          <Route path="dispositivos" element={<DevicesPage />} />
          <Route path="*" element={<Navigate to="/painel" replace />} />
        </Route>
      </Routes>
    </QueryClientProvider>
  );
}
