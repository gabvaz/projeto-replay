import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router";
import { UnauthorizedError } from "./api";
import { ArenaLayout } from "./ArenaLayout";
import { BrandingPage } from "./pages/BrandingPage";
import { ClipsPage } from "./pages/ClipsPage";
import { CourtsPage } from "./pages/CourtsPage";
import { EntryPage } from "./pages/EntryPage";
import { HomePage } from "./pages/HomePage";
import { InvoicesPage } from "./pages/InvoicesPage";
import { MorePage } from "./pages/MorePage";
import { StatusPage } from "./pages/StatusPage";

function toEntry(err: unknown) {
  if (err instanceof UnauthorizedError && !location.pathname.startsWith("/arena/entrar")) {
    location.assign("/arena/entrar");
  }
}

function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
}

/** Portal da arena. Chunk separado (lazy no main.tsx); sem refresh automático. */
export default function ArenaApp() {
  useNoIndex();
  const [client] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({ onError: toEntry }),
        mutationCache: new MutationCache({ onError: toEntry }),
        defaultOptions: {
          queries: {
            retry: (count, err) => !(err instanceof UnauthorizedError) && count < 1,
            staleTime: 60_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <Routes>
        <Route path="entrar" element={<EntryPage />} />
        <Route element={<ArenaLayout />}>
          <Route index element={<HomePage />} />
          <Route path="clips" element={<ClipsPage />} />
          <Route path="quadras" element={<CourtsPage />} />
          <Route path="faturas" element={<InvoicesPage />} />
          <Route path="status" element={<StatusPage />} />
          <Route path="personalizar" element={<BrandingPage />} />
          <Route path="mais" element={<MorePage />} />
          <Route path="*" element={<Navigate to="/arena" replace />} />
        </Route>
      </Routes>
    </QueryClientProvider>
  );
}
