import { ReservationPanel } from "./reservation-panel";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12">
      <header className="mb-10">
        <h1 className="text-2xl font-semibold tracking-tight">FormEcho</h1>
        <p className="mt-2 text-sm text-black/60 dark:text-white/60">
          自然文から予約フォームを埋める検証環境。
        </p>
      </header>

      {/* タブは MVP では1つ。会議ロジドメインを足すチケットで2つ増える。 */}
      <nav className="mb-6 border-b border-black/10 dark:border-white/15">
        <span className="inline-block border-b-2 border-foreground px-1 pb-2 text-sm font-medium">
          交通IC予約
        </span>
      </nav>

      <ReservationPanel />
    </main>
  );
}
