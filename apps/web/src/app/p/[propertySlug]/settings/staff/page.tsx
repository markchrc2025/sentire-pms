import { getDb } from "@sentire-pms/db";
import { Badge, Card, Field, Notice, PageHeader, Select, Table, formatDateTime } from "@/components/ui";
import { ActionForm } from "@/components/ui/ActionForm";
import { requireTenant } from "@/server/iam/request";
import { can } from "@/server/iam/tenant";
import { listStaff } from "@/server/iam/staff";
import { labelRole } from "@/server/shell/context";
import { addStaffAction, staffActiveAction, staffPasswordAction, staffRoleAction } from "../actions";

const ROLES = ["OWNER", "ADMIN", "FRONT_DESK", "HOUSEKEEPING", "ACCOUNTANT"].map((r) => ({ value: r, label: labelRole(r) }));

export default async function StaffPage({ params }: { params: Promise<{ propertySlug: string }> }) {
  const { propertySlug } = await params;
  const ctx = await requireTenant(propertySlug);
  if (!can(ctx, "users.manage")) {
    return (
      <>
        <PageHeader title="Staff" />
        <Notice>Only an Owner or Admin can manage staff.</Notice>
      </>
    );
  }
  const staff = await listStaff(getDb(), ctx);
  const roles = ctx.role === "OWNER" ? ROLES : ROLES.filter((r) => r.value !== "OWNER");
  return (
    <>
      <PageHeader title="Staff" subtitle="People who can sign in to this property and what they may do." />
      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <Table head={["Name", "Email", "Role", "Status", "Last sign-in", "Reset password", ""]}>
            {staff.map((s) => (
              <tr key={s.id}>
                <td className="font-semibold">{s.name}{s.id === ctx.userId && <span className="ml-1 text-[11px] text-muted">you</span>}</td>
                <td>{s.email}</td>
                <td>
                  {s.id === ctx.userId || (s.role === "OWNER" && ctx.role !== "OWNER") ? (
                    labelRole(s.role)
                  ) : (
                    <ActionForm inline variant="secondary" action={staffRoleAction.bind(null, propertySlug, s.id)} submitLabel="Change">
                      <label className="sr-only" htmlFor={`role-${s.id}`}>Role for {s.name}</label>
                      <select id={`role-${s.id}`} name="role" defaultValue={s.role} className="h-8 rounded-control border border-line bg-surface px-2 text-[12px]">
                        {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                    </ActionForm>
                  )}
                </td>
                <td>{s.active ? <Badge status="CLEAN">Active</Badge> : <Badge status="CHECKED_OUT">Deactivated</Badge>}</td>
                <td className="whitespace-nowrap text-muted">{s.lastSignInAt ? formatDateTime(s.lastSignInAt) : "Never"}</td>
                <td>
                  {s.id !== ctx.userId && (
                    <ActionForm inline variant="secondary" action={staffPasswordAction.bind(null, propertySlug, s.id)} submitLabel="Reset">
                      <label className="sr-only" htmlFor={`pw-${s.id}`}>New password for {s.name}</label>
                      <input id={`pw-${s.id}`} name="password" type="password" autoComplete="new-password" placeholder="New password" className="h-8 w-[140px] rounded-control border border-line px-2 text-[12px]" />
                    </ActionForm>
                  )}
                </td>
                <td className="text-right">{s.id !== ctx.userId && <ActionForm inline variant={s.active ? "danger" : "secondary"} action={staffActiveAction.bind(null, propertySlug, s.id, !s.active)} submitLabel={s.active ? "Deactivate" : "Reactivate"} confirm={s.active ? `Deactivate ${s.name}? They are signed out at once.` : undefined} />}</td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="Add staff">
          <ActionForm action={addStaffAction.bind(null, propertySlug)} submitLabel="Add staff" resetOnOk>
            <Field label="Name" name="name" required />
            <Field label="Email" name="email" type="email" required />
            <Select label="Role" name="role" options={roles} defaultValue="FRONT_DESK" />
            <Field label="Temporary password" name="password" type="password" autoComplete="new-password" hint="At least 10 characters with a number. Give it to them in person." required />
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
