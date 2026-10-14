import { Link2 } from "lucide-react";
import { useSearchParams } from "react-router";
import { LogoIcon } from "../../components/Logo";

/** Não tem login: o acesso é pelo link que a Replay manda. Aqui só explica isso. */
export function EntryPage() {
  const [params] = useSearchParams();
  const invalid = params.get("erro") === "link";

  return (
    <main className="flex min-h-svh items-center justify-center px-4">
      <div className="animate-rise-in w-full max-w-sm rounded-3xl border border-line bg-surface p-6 text-center shadow-2xl">
        <LogoIcon className="mx-auto size-12" />
        <h1 className="font-display mt-4 text-4xl leading-none font-black uppercase italic">Portal da arena</h1>
        {invalid ? (
          <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            Esse link não vale mais. Pede um novo pra equipe Replay.
          </p>
        ) : (
          <p className="mt-4 text-sm text-zinc-400">Sua sessão terminou ou você ainda não entrou neste aparelho.</p>
        )}
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-ink/60 p-3 text-left text-sm text-zinc-300">
          <Link2 className="mt-0.5 size-4 shrink-0 text-lime" />
          Abra o link de acesso que a Replay te mandou no WhatsApp. Ele funciona em qualquer celular ou computador.
        </p>
      </div>
    </main>
  );
}
