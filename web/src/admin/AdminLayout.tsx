import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Cpu, LayoutDashboard, Loader2, LogOut, Package, Wallet } from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { LogoIcon } from "../components/Logo";
import { adminFetch, get } from "./api";

const NAV = [
  { to: "/painel", label: "Visão geral", short: "Geral", icon: LayoutDashboard, end: true },
  { to: "/painel/arenas", label: "Arenas", short: "Arenas", icon: Building2 },
  { to: "/painel/equipamentos", label: "Equipamentos", short: "Equip.", icon: Package },
  { to: "/painel/financeiro", label: "Financeiro", short: "Grana", icon: Wallet },
  { to: "/painel/dispositivos", label: "Dispositivos", short: "Pis", icon: Cpu },
] as const;

export function AdminLayout() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const session = useQuery({ queryKey: ["session"], queryFn: () => get<{ ok: true; exp: number | null }>("/session") });

  async function logout() {
    await adminFetch("/session", "DELETE").catch(() => {});
    qc.clear();
    navigate("/painel/login", { replace: true });
  }

  if (!session.data) {
    return (
      <div className="flex min-h-svh items-center justify-center text-zinc-500">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-svh md:flex">
      <aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col border-r border-line bg-ink/60 p-4 md:flex">
        <div className="mb-8 flex items-center gap-2 px-2">
          <LogoIcon className="size-7" />
          <span className="font-display text-2xl leading-none font-black uppercase italic">Replay</span>
          <span className="ml-auto rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-zinc-400 uppercase">
            Admin
          </span>
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
        <button
          type="button"
          onClick={logout}
          className="mt-auto flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold text-zinc-500 transition hover:bg-white/5 hover:text-white"
        >
          <LogOut className="size-4" />
          Sair
        </button>
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-ink/85 px-4 py-3 pt-[calc(0.75rem+env(safe-area-inset-top))] backdrop-blur-xl md:hidden">
        <div className="flex items-center gap-2">
          <LogoIcon className="size-6" />
          <span className="font-display text-xl leading-none font-black uppercase italic">Painel</span>
        </div>
        <button type="button" onClick={logout} aria-label="Sair" className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/5">
          <LogOut className="size-5" />
        </button>
      </header>

      <main className="min-w-0 flex-1 px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] md:px-8 md:pb-10">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-ink/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
        {NAV.map(({ to, short, icon: Icon, ...rest }) => (
          <NavLink
            key={to}
            to={to}
            end={"end" in rest}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold ${isActive ? "text-lime" : "text-zinc-500"}`
            }
          >
            <Icon className="size-5" />
            {short}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
