import { useRef, useState } from "react";
import { sendEvent } from "../api";

type Props = {
  clipId: string;
  videoUrl: string;
  title: string;
};

type State = "idle" | "loading" | "tap-again" | "copied";

/**
 * Tenta compartilhar o ARQUIVO (Instagram/WhatsApp); senão o link; senão copia.
 * Safari exige gesto recente pro share: se o download demorar e o share for recusado,
 * o arquivo fica em cache e o próximo toque compartilha na hora.
 */
export function ShareButton({ clipId, videoUrl, title }: Props) {
  const [state, setState] = useState<State>("idle");
  const fileRef = useRef<File | null>(null);
  const pageUrl = `${location.origin}/v/${clipId}`;

  async function shareFile(file: File): Promise<boolean> {
    if (typeof navigator.canShare !== "function" || !navigator.canShare({ files: [file] })) {
      return false;
    }
    await navigator.share({ files: [file], title });
    return true;
  }

  async function share() {
    try {
      if (fileRef.current) {
        if (await shareFile(fileRef.current)) {
          sendEvent(clipId, "share");
          setState("idle");
          return;
        }
      } else if (typeof navigator.canShare === "function") {
        setState("loading");
        const blob = await (await fetch(videoUrl)).blob();
        fileRef.current = new File([blob], `replay-${clipId}.mp4`, { type: "video/mp4" });
        try {
          if (await shareFile(fileRef.current)) {
            sendEvent(clipId, "share");
            setState("idle");
            return;
          }
        } catch (err) {
          if ((err as DOMException)?.name === "NotAllowedError") {
            setState("tap-again");
            return;
          }
          throw err;
        }
      }

      if (typeof navigator.share === "function") {
        await navigator.share({ url: pageUrl, title });
        sendEvent(clipId, "share");
        setState("idle");
        return;
      }
      await navigator.clipboard.writeText(pageUrl);
      sendEvent(clipId, "share");
      setState("copied");
      setTimeout(() => setState("idle"), 2000);
    } catch (err) {
      setState(fileRef.current ? "tap-again" : "idle");
      if ((err as DOMException)?.name !== "AbortError") console.warn("share falhou", err);
    }
  }

  const text = {
    idle: "Compartilhar",
    loading: "Preparando…",
    "tap-again": "Toque pra compartilhar",
    copied: "Link copiado!",
  }[state];

  return (
    <button
      type="button"
      onClick={share}
      disabled={state === "loading"}
      className={`flex-1 rounded-xl px-4 py-3 text-base font-semibold transition disabled:opacity-60 ${
        state === "tap-again" ? "bg-brand text-zinc-950" : "bg-zinc-800 hover:bg-zinc-700"
      }`}
    >
      {text}
    </button>
  );
}
