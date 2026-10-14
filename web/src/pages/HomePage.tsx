import { VenueHeader } from "../components/VenueHeader";

export function HomePage() {
  return (
    <>
      <VenueHeader />
      <main className="mx-auto flex max-w-2xl flex-col items-center gap-4 px-6 py-20 text-center">
        <div className="text-6xl">🎾</div>
        <h1 className="text-2xl font-bold">Seu replay está na quadra</h1>
        <p className="text-zinc-400">
          Aperte o botão de replay na quadra e escaneie o QR code ao lado dele pra ver, baixar e
          compartilhar o lance.
        </p>
      </main>
    </>
  );
}
