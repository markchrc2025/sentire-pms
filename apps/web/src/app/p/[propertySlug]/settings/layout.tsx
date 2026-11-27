import { SettingsNav } from "./SettingsNav";

export default async function SettingsLayout({ children, params }: { children: React.ReactNode; params: Promise<{ propertySlug: string }> }) {
  const { propertySlug } = await params;
  return (
    <div>
      <SettingsNav base={`/p/${propertySlug}/settings`} />
      {children}
    </div>
  );
}
