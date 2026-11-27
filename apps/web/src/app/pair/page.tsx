import { PairForm } from "./PairForm";

export const dynamic = "force-dynamic";

export default function PairPage() {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <section className="w-full max-w-[420px] rounded-card border border-line bg-surface p-8">
        <div className="flex h-11 w-11 items-center justify-center rounded-[10px] bg-tile text-xl font-bold text-white" aria-hidden="true">S</div>
        <h1 className="mb-1 mt-4 text-2xl font-bold">Pair this device</h1>
        <p className="m-0 text-sm text-muted">This hub only works with devices its Admin has approved. Enter the one-time code to connect.</p>
        <PairForm />
      </section>
    </main>
  );
}
