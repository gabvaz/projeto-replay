import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ImagePlus, Play, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { LogoIcon } from "../../components/Logo";
import { BrandLogo, BrandScope, type Brand } from "../../shared/brand";
import { Button, Card, ErrorNote, Field, inputCls, Loading, PageHeader } from "../../shared/ui";
import { useMe } from "../ArenaLayout";
import { errorText, portalFetch, portalUpload, type Me } from "../api";

const DEFAULT_COLOR = "#d7ff3a";

/** Miniatura da galeria pública com a marca aplicada. */
function Preview({ brand }: { brand: Brand }) {
  return (
    <BrandScope color={brand.color} className="overflow-hidden rounded-2xl border border-line bg-ink">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <LogoIcon className="size-5" />
        <span className="font-display text-sm font-black uppercase italic">Replay</span>
      </div>
      <div className="bg-stage px-4 py-5">
        <div className="flex items-center gap-3">
          <BrandLogo brand={brand} className="size-12" />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-wide text-lime uppercase">{brand.name}</p>
            <p className="font-display text-3xl leading-none font-black uppercase italic">Quadra 1</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {["21:42", "21:37", "21:30"].map((t, i) => (
            <div key={t} className={`relative aspect-[9/12] rounded-lg bg-surface-2 ${i === 0 ? "ring-2 ring-lime" : ""}`}>
              <span className="absolute bottom-1.5 left-1.5 text-[10px] font-bold">{t}</span>
              {i === 0 && <Play className="absolute top-1/2 left-1/2 size-5 -translate-1/2 fill-lime text-lime" />}
            </div>
          ))}
        </div>
        <span className="mt-4 block rounded-full bg-lime py-2 text-center text-xs font-bold text-ink">Baixar meu lance</span>
      </div>
    </BrandScope>
  );
}

export function BrandingPage() {
  const me = useMe();
  if (!me.data) return <Loading />;
  return <BrandingForm me={me.data} />;
}

function BrandingForm({ me }: { me: Me }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(me.venue.public_name ?? "");
  const [color, setColor] = useState<string | null>(me.venue.brand_color);
  const [saved, setSaved] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["me"] });

  const save = useMutation({
    mutationFn: () => portalFetch("/branding", "PATCH", { public_name: name, brand_color: color }),
    onSuccess: () => {
      void refresh();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });
  const upload = useMutation({ mutationFn: (f: File) => portalUpload("/branding/logo", f), onSuccess: refresh });
  const removeLogo = useMutation({ mutationFn: () => portalFetch("/branding/logo", "DELETE"), onSuccess: refresh });

  const preview: Brand = { name: name.trim() || me.venue.name, color, logo_url: me.brand.logo_url };
  const error = save.error ?? upload.error ?? removeLogo.error;

  return (
    <>
      <PageHeader title="Personalizar" subtitle="É assim que os jogadores veem sua arena ao escanear o QR" />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <div className="flex flex-col gap-5">
            <Field label="Logo" hint="PNG, JPG ou WEBP até 300 KB. Fundo transparente fica melhor.">
              <div className="flex items-center gap-3">
                {me.brand.logo_url ? (
                  <BrandLogo brand={me.brand} className="size-16" />
                ) : (
                  <div className="flex size-16 items-center justify-center rounded-xl border border-dashed border-line text-zinc-600">
                    <ImagePlus className="size-6" />
                  </div>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) upload.mutate(f);
                    e.target.value = "";
                  }}
                />
                <Button size="sm" loading={upload.isPending} onClick={() => fileRef.current?.click()}>
                  <ImagePlus className="size-3.5" /> {me.brand.logo_url ? "Trocar" : "Enviar logo"}
                </Button>
                {me.brand.logo_url && (
                  <Button size="sm" variant="ghost" loading={removeLogo.isPending} onClick={() => removeLogo.mutate()}>
                    <Trash2 className="size-3.5" /> Remover
                  </Button>
                )}
              </div>
            </Field>

            <Field label="Nome na galeria" hint={`Em branco usa "${me.venue.name}".`}>
              <input className={inputCls} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={me.venue.name} />
            </Field>

            <div>
              <p className="mb-2 text-xs font-semibold text-zinc-400">Cor de destaque</p>
              <div className="flex flex-wrap gap-2">
                {me.brand_colors.map((c) => {
                  const active = (color ?? DEFAULT_COLOR) === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Cor ${c}`}
                      aria-pressed={active}
                      onClick={() => setColor(c === DEFAULT_COLOR ? null : c)}
                      className={`flex size-10 items-center justify-center rounded-full transition ${
                        active ? "ring-2 ring-white ring-offset-2 ring-offset-surface" : "hover:scale-105"
                      }`}
                      style={{ background: c }}
                    >
                      {active && <Check className="size-4 text-ink" />}
                    </button>
                  );
                })}
              </div>
            </div>

            <ErrorNote>{error && errorText(error)}</ErrorNote>
            <div>
              <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
                {saved ? <Check className="size-4" /> : null}
                {saved ? "Salvo" : "Salvar"}
              </Button>
            </div>
          </div>
        </Card>
        <div>
          <p className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Prévia</p>
          <Preview brand={preview} />
        </div>
      </div>
    </>
  );
}
