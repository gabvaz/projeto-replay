import "@fontsource-variable/inter";
import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-800.css";
import "@fontsource/barlow-condensed/latin-900-italic.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { NotFoundError } from "./api";
import { ClipPage } from "./pages/ClipPage";
import { CourtPage } from "./pages/CourtPage";
import { HomePage } from "./pages/HomePage";
import "./index.css";

const QrPage = lazy(() => import("./pages/QrPage").then((m) => ({ default: m.QrPage })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => !(err instanceof NotFoundError) && count < 2,
      refetchOnWindowFocus: true,
    },
  },
});

const router = createBrowserRouter([
  { path: "/", element: <HomePage /> },
  { path: "/q/:key", element: <CourtPage /> },
  {
    path: "/q/:key/qr",
    element: (
      <Suspense fallback={null}>
        <QrPage />
      </Suspense>
    ),
  },
  { path: "/v/:id", element: <ClipPage /> },
  { path: "*", element: <HomePage /> },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
