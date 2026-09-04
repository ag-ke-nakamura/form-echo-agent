import { FormEchoTabs } from "./form-echo-tabs";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-12">
      <header className="mb-10">
        <h1 className="text-std-28B-150 text-solid-gray-900">FormEcho</h1>
        <p className="mt-2 text-dns-14N-130 text-solid-gray-700">
          自然文からフォームを埋める検証環境。
        </p>
      </header>

      <FormEchoTabs />
    </main>
  );
}
