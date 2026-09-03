import { FormEchoTabs } from "./form-echo-tabs";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12">
      <header className="mb-10">
        <h1 className="text-2xl font-semibold tracking-tight">FormEcho</h1>
        <p className="mt-2 text-sm text-black/60 dark:text-white/60">
          自然文からフォームを埋める検証環境。
        </p>
      </header>

      <FormEchoTabs />
    </main>
  );
}
