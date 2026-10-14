import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Film,
  Grid2x2,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  Palette,
  Receipt,
  TriangleAlert,
} from "lucide-react";
import { useEffect } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router";
import { LogoIcon } from "../components/Logo";
import { BrandLogo, BrandScope } from "../shared/brand";
import { brl } from "../shared/format";
import { get, portalFetch, type Me } from "./api";

const NAV = [
  { to: "/arena", label: "Início", icon: LayoutDashboard, end: true, mobile: true },
  { to: "/arena/clips", label: "Clips", icon: Film, mobile: true },
  { to: "/arena/quadras", label: "Quadras", icon: Grid2x2, mobile: true },
  { to: "/arena/faturas", label: "Faturas", icon: Receipt, mobile: true },
  { to: "/arena/status", label: "Status", icon: Activity },
  { to: "/arena/personalizar", label: "Personalizar", icon: Palette },
] as const;

export const useMe = () => useQuery({ queryKey: ["me"], queryFn: () => get<Me>("/me") });

export function useLogout() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  return async () => {
    await portalFetch("/session", "DELETE").catch(() => {});
    qc.clear();
    navigate("/arena/entrar", { replace: true });
  };
}

export function ArenaLayout() {
  const me = useMe();
  const logout = useLogout();

  useEffect(() => {
    if (me.data) document.title = `${me.data.brand.name} · Replay`;
  }, [me.data]);

  if (!me.data) {
    return (
      <div className="flex min-h-svh items-center justify-center text-zinc-500">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }
  const { brand, overdue } = me.data;

  return (
    <BrandScope color={brand.color} className="min-h-svh md:flex">
      <aside className="sticky top-0 hidden h-svh w-64 shrink-0 flex-col border-r border-line bg-ink/60 p-4 md:flex">
        <div className="mb-8 flex items-center gap-3 px-2">
          {brand.logo_url ? <BrandLogo brand={brand} className="size-10" /> : <LogoIcon className="size-8" />}
          <div className="min-w-0">
            <p className="truncate font-semibold">{brand.name}</p>
            <p className="text-[11px] text-zinc-500">Portal da arena</p>
          </div>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map(({ to, label, icon: Icon, ...rest }) => (
            <NavLink
              key={to}
              to={to}
              end={"end" in rest}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                  isActive ? "bg-lime text-ink" : "text-zinc-400 hover:bg-white/5 hover:text-white"
                }`
              }
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-3">
          <p className="flex items-center gap-1.5 px-3 text-[11px] text-zinc-600">
            <LogoIcon className="size-4" /> Replay
          </p>
          <button
            type="button"
            onClick={logout}
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold text-zinc-500 transition hover:bg-white/5 hover:text-white"
          >
            <LogOut className="size-4" />
            Sair
          </button>
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-ink/85 px-4 py-3 pt-[calc(0.75rem+env(safe-area-inset-top))] backdrop-blur-xl md:hidden">
        {brand.logo_url ? <BrandLogo brand={brand} className="size-8" /> : <LogoIcon className="size-7" />}
        <p className="min-w-0 truncate font-semibold">{brand.name}</p>
      </header>

      <main className="min-w-0 flex-1 px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] md:px-8 md:pb-10">
        <div className="mx-auto max-w-5xl">
          {overdue.n > 0 && (
            <Link
              to="/arena/faturas"
              className="mb-5 flex items-center gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
            >
              <TriangleAlert className="size-5 shrink-0 text-red-300" />
              <span>
                {overdue.n === 1 ? "1 mensalidade atrasada" : `${overdue.n} mensalidades atrasadas`} ·{" "}
                <span className="font-bold">{brl(overdue.cents)}</span>
              </span>
            </Link>
          )}
          <Outlet />
        </div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-ink/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
        {NAV.filter((n) => "mobile" in n).map(({ to, label, icon: Icon, ...rest }) => (
          <NavLink
            key={to}
            to={to}
            end={"end" in rest}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold ${isActive ? "text-lime" : "text-zinc-500"}`
            }
          >
            <Icon className="size-5" />
            {label}
          </NavLink>
        ))}
        <NavLink
          to="/arena/mais"
          className={({ isActive }) =>
            `flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold ${isActive ? "text-lime" : "text-zinc-500"}`
          }
        >
          <Menu className="size-5" />
          Mais
        </NavLink>
      </nav>
    </BrandScope>
  );
}
