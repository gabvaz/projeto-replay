import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { NotFoundError } from "./api";
import { ClipPage } from "./pages/ClipPage";
import { CourtPage } from "./pages/CourtPage";
import { HomePage } from "./pages/HomePage";
import { QrPage } from "./pages/QrPage";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => !(err instanceof NotFoundError) && count < 2,
      refetchOnWindowFocus: true,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/q/:key" element={<CourtPage />} />
          <Route path="/q/:key/qr" element={<QrPage />} />
          <Route path="/v/:id" element={<ClipPage />} />
          <Route path="*" element={<HomePage />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
