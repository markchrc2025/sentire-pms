import { RatesNav } from "./RatesNav";

export default async function RatesLayout({ children, params }: { children: React.ReactNode; params: Promise<{ propertySlug: string }> }) {
  const { propertySlug } = await params;
  return (
    <div>
      <RatesNav base={`/p/${propertySlug}/rates`} />
      {children}
    </div>
  );
}
