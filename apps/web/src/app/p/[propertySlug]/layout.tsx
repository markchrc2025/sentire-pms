import { SideNav } from "@/components/shell/SideNav";
import { TopBar } from "@/components/shell/TopBar";
import { getShellContext } from "@/server/shell/context";
import { connectionState } from "@/server/sync/status";

export const dynamic = "force-dynamic";

export default async function StaffLayout({ children, params }: { children: React.ReactNode; params: Promise<{ propertySlug: string }> }) {
  const { propertySlug } = await params;
  const s = await getShellContext(propertySlug);
  const conn = await connectionState();
  return (
    <div className="flex min-h-screen flex-col bg-bg text-ink">
      <TopBar propertySlug={s.propertySlug} propertyName={s.propertyName} properties={s.properties} userInitials={s.userInitials} userName={s.userName} role={s.role} connection={conn} />
      <div className="flex flex-1 flex-col md:flex-row">
        <SideNav propertySlug={s.propertySlug} businessDate={s.businessDate} />
        <main className="min-w-0 flex-1 p-6 md:px-7">{children}</main>
      </div>
    </div>
  );
}
