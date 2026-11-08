import { Lock, Mail } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { Logo, RecDot } from "../../components/Logo";
import { portalFetch, UnauthorizedError } from "../api";
import { Button, ErrorNote, inputCls } from "../../shared/ui";

export function EntryPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await portalFetch("/session", "POST", { email: email.trim(), password });
      navigate("/arena", { replace: true });
    } catch (err) {
      setError(err instanceof UnauthorizedError ? "Email ou senha inválidos." : "Não deu pra entrar. Tenta de novo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center px-4">
      <form onSubmit={submit} className="animate-rise-in w-full max-w-sm rounded-3xl border border-line bg-surface p-6 shadow-2xl">
        <Logo className="mx-auto h-10" />
        <h1 className="font-display mt-4 text-center text-4xl leading-none">
          Portal da arena
          <RecDot />
        </h1>
        <p className="mt-3 text-center text-sm text-zinc-400">Entre com o email e a senha que a gente te passou.</p>
        <label className="mt-6 flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-zinc-400">Email</span>
          <div className="relative">
            <Mail className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-600" />
            <input
              type="email"
              autoComplete="username"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`${inputCls} pl-9`}
              placeholder="arena@exemplo.com"
            />
          </div>
        </label>
        <label className="mt-3 flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-zinc-400">Senha</span>
          <div className="relative">
            <Lock className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-600" />
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${inputCls} pl-9`}
              placeholder="••••••••"
            />
          </div>
        </label>
        <div className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
        <Button
          type="submit"
          variant="primary"
          className="mt-4 w-full py-2.5"
          loading={loading}
          disabled={!email.trim() || password.length < 8}
        >
          Entrar
        </Button>
      </form>
    </main>
  );
}
