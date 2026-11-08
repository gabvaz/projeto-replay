import { Hand, QrCode, Trophy } from "lucide-react";
import { RecDot } from "./Logo";

const STEPS = [
  { icon: Trophy, title: "Jogue.", text: "Fez um ponto bonito? Não precisa parar o jogo." },
  { icon: Hand, title: "Aperte.", text: "O botão na quadra salva os últimos 20 segundos." },
  { icon: QrCode, title: "Reveja.", text: "O QR abre seus replays. Baixe e compartilhe." },
] as const;

export function HowItWorks({ className = "" }: { className?: string }) {
  return (
    <ol className={`grid gap-3 sm:grid-cols-3 ${className}`}>
      {STEPS.map(({ icon: Icon, title, text }, i) => (
        <li
          key={title}
          className="animate-rise-in relative overflow-hidden rounded-2xl border border-line bg-surface p-4 text-left"
          style={{ animationDelay: `${i * 80}ms` }}
        >
          <span className="font-mono absolute -top-1 right-3 text-6xl font-medium text-white/[0.04]">
            {String(i + 1).padStart(2, "0")}
          </span>
          <Icon className="size-6 text-white" />
          <p className="font-display mt-3 text-2xl leading-none">
            {title.replace(".", "")}
            <RecDot />
          </p>
          <p className="mt-1 text-sm text-zinc-400">{text}</p>
        </li>
      ))}
    </ol>
  );
}
