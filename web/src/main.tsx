import "@fontsource-variable/urbanist";
import "@fontsource/dm-mono/400.css";
import "@fontsource/dm-mono/500.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider, useLocation, useParams } from "react-router";
import { NotFoundError } from "./api";
import { ClipPage } from "./pages/ClipPage";
import { CourtPage } from "./pages/CourtPage";
import { HomePage } from "./pages/HomePage";
import { VenuePage } from "./pages/VenuePage";
import { paths } from "./routes";
import "./index.css";

const QrPage = lazy(() => import("./pages/QrPage").then((m) => ({ default: m.QrPage })));
const AdminApp = lazy(() => import("./admin/AdminApp"));
const ArenaApp = lazy(() => import("./arena/ArenaApp"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => !(err instanceof NotFoundError) && count < 2,
      refetchOnWindowFocus: true,
    },
  },
});

/** Compat: QR/impressos antigos `/q` `/g` `/v`. */
function LegacyCourt({ qr = false }: { qr?: boolean }) {
  const { key = "" } = useParams();
  const { search } = useLocation();
  return <Navigate to={(qr ? paths.courtQr(key) : paths.court(key)) + search} replace />;
}
function LegacyGallery() {
  const { key = "" } = useParams();
  const { search } = useLocation();
  return <Navigate to={paths.gallery(key) + search} replace />;
}
function LegacyReplay() {
  const { id = "" } = useParams();
  const { search } = useLocation();
  return <Navigate to={paths.replay(id) + search} replace />;
}

const router = createBrowserRouter([
  { path: "/", element: <HomePage /> },
  { path: "/quadra/:key", element: <CourtPage /> },
  {
    path: "/quadra/:key/qr",
    element: (
      <Suspense fallback={null}>
        <QrPage />
      </Suspense>
    ),
  },
  { path: "/galeria/:key", element: <VenuePage /> },
  { path: "/replay/:id", element: <ClipPage /> },
  { path: "/q/:key", element: <LegacyCourt /> },
  { path: "/q/:key/qr", element: <LegacyCourt qr /> },
  { path: "/g/:key", element: <LegacyGallery /> },
  { path: "/v/:id", element: <LegacyReplay /> },
  {
    path: "/painel/*",
    element: (
      <Suspense fallback={<div className="min-h-svh bg-ink" />}>
        <AdminApp />
      </Suspense>
    ),
  },
  {
    path: "/arena/*",
    element: (
      <Suspense fallback={<div className="min-h-svh bg-ink" />}>
        <ArenaApp />
      </Suspense>
    ),
  },
  { path: "*", element: <HomePage /> },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
