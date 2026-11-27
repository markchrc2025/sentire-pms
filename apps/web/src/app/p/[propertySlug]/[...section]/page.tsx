import Link from "next/link";
import { notFound } from "next/navigation";
import { findNav } from "@/components/shell/nav";

const MOCKUP = "https://claude.ai/artifact/38WkRbrpdW9NDpLtNAgEAf";

export default async function SectionPage({ params }: { params: Promise<{ propertySlug: string; section: string[] }> }) {
  const { propertySlug, section } = await params;
  const item = findNav(section.join("/"));
  if (!item) notFound();
  return (
    <div className="flex flex-col gap-5">
      <h1 className="m-0 text-[22px] font-bold">{item.label}</h1>
      <section className="rounded-card border border-line bg-surface p-6 text-sm leading-relaxed">
        <p className="m-0">
          This screen is built in <b>{item.phase}</b> of the Build Plan.
        </p>
        <p className="mb-0 mt-2 text-muted">
          See the agreed design in the <a href={MOCKUP}>clickable mockup</a>, or go back to the{" "}
          <Link href={`/p/${propertySlug}`}>dashboard</Link>.
        </p>
      </section>
    </div>
  );
}
