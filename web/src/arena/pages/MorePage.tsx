import { Activity, ChevronRight, LogOut, Palette } from "lucide-react";
import { Link } from "react-router";
import { PageHeader } from "../../shared/ui";
import { useLogout } from "../ArenaLayout";

const ITEMS = [
  { to: "/arena/status", label: "Status", hint: "Câmeras e último clip", icon: Activity },
  { to: "/arena/personalizar", label: "Personalizar", hint: "Logo, nome e cor da galeria", icon: Palette },
];

/** Menu do celular para o que não cabe na tab bar. */
export function MorePage() {
  const logout = useLogout();
  return (
    <>
      <PageHeader title="Mais" />
      <ul className="overflow-hidden rounded-2xl border border-line bg-surface">
        {ITEMS.map(({ to, label, hint, icon: Icon }) => (
          <li key={to} className="border-b border-line last:border-0">
            <Link to={to} className="flex items-center gap-3 px-4 py-3.5 hover:bg-white/[0.02]">
              <Icon className="size-5 text-lime" />
              <span className="flex-1">
                <span className="block font-semibold">{label}</span>
                <span className="text-xs text-zinc-500">{hint}</span>
              </span>
              <ChevronRight className="size-4 text-zinc-600" />
            </Link>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={logout}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-line px-4 py-3 text-sm font-semibold text-zinc-400"
      >
        <LogOut className="size-4" /> Sair deste aparelho
      </button>
    </>
  );
}
