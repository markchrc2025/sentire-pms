import { SideNav } from "@/components/shell/SideNav";
import { TopBar } from "@/components/shell/TopBar";
import { getShellContext } from "@/server/shell/context";
import { connectionState } from "@/server/sync/status";
import { NAV } from "@/components/shell/nav";
import { roleAllows } from "@/server/iam/permissions";

export const dynamic = "force-dynamic";

export default async function StaffLayout({ children, params }: { children: React.ReactNode; params: Promise<{ propertySlug: string }> }) {
  const { propertySlug } = await params;
  const s = await getShellContext(propertySlug);
  const conn = await connectionState();
  const allowed = NAV.flatMap((g) => g.items).filter((i) => roleAllows(s.roleKey, i.perm)).map((i) => i.key);
  return (
    <div className="flex min-h-screen flex-col bg-bg text-ink print:bg-white">
      <TopBar propertySlug={s.propertySlug} propertyName={s.propertyName} properties={s.properties} userInitials={s.userInitials} userName={s.userName} role={s.role} connection={conn} canBook={roleAllows(s.roleKey, "reservations.manage")} />
      <div className="flex flex-1 flex-col md:flex-row">
        <SideNav propertySlug={s.propertySlug} businessDate={s.businessDate} allowed={allowed} />
        <main className="min-w-0 flex-1 p-6 md:px-7 print:p-0">{children}</main>
      </div>
    </div>
  );
}
