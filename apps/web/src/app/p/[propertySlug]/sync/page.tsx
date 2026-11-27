import { getDb } from "@sentire-pms/db";
import { Badge, Card, Field, Notice, PageHeader, Table, formatDateTime } from "@/components/ui";
import { ActionForm } from "@/components/ui/ActionForm";
import { requireTenant } from "@/server/iam/request";
import { can } from "@/server/iam/tenant";
import { syncOverview } from "@/server/sync/admin";
import { listDevices, pairingRequired } from "@/server/iam/devices";
import { enrollAction, issueAction, pairingCodeAction, revokeDeviceAction, syncNowAction } from "./actions";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { WINDOWS_DESKTOP: "Windows PC", ANDROID_TABLET: "Android tablet", IPAD: "iPad", MAC_DESKTOP: "Mac", BROWSER: "Browser" };

export default async function SyncPage({ params }: { params: Promise<{ propertySlug: string }> }) {
  const { propertySlug } = await params;
  const ctx = await requireTenant(propertySlug);
  if (!can(ctx, "settings.manage")) return <Notice kind="warn">Only an Owner or Admin can manage sync and devices.</Notice>;
  const db = getDb();
  const [o, devs] = await Promise.all([syncOverview(db, ctx), listDevices(db, ctx)]);
  const online = o.lastSuccessAt && Date.now() - o.lastSuccessAt.getTime() < 2 * 60_000;
  return (
    <>
      <PageHeader title="Sync and devices" subtitle="This PC is the property hub. It works without internet and syncs with Sentire Cloud whenever it can." />
      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Sentire Cloud" actions={o.enrolled ? <ActionForm inline showOk variant="secondary" action={syncNowAction.bind(null, propertySlug)} submitLabel="Sync now" /> : undefined}>
          {o.enrolled ? (
            <dl className="m-0 grid grid-cols-[160px_1fr] gap-y-2 text-[13px]">
              <dt className="text-muted">Status</dt>
              <dd className="m-0">{online ? <Badge status="CLEAN">Online</Badge> : <Badge status="DIRTY">Offline{o.lastSuccessAt ? ` since ${formatDateTime(o.lastSuccessAt)}` : ""}</Badge>}</dd>
              <dt className="text-muted">Changes waiting</dt>
              <dd className="m-0">{o.pending}</dd>
              <dt className="text-muted">Last successful sync</dt>
              <dd className="m-0">{o.lastSuccessAt ? formatDateTime(o.lastSuccessAt) : "Not yet"}</dd>
              <dt className="text-muted">Cloud address</dt>
              <dd className="m-0 break-all">{o.cloudUrl}</dd>
              <dt className="text-muted">Connected since</dt>
              <dd className="m-0">{formatDateTime(o.enrolledAt)}</dd>
              {o.lastError && (
                <>
                  <dt className="text-muted">Last error</dt>
                  <dd className="m-0 text-[#991b1b]">{o.lastError}{o.nextAttemptAt ? `. Next try ${formatDateTime(o.nextAttemptAt)}.` : ""}</dd>
                </>
              )}
            </dl>
          ) : (
            <>
              <p className="mt-0 text-[13px] text-muted">Not connected. Everything still works here; connecting adds online bookings, cloud backups and the owner view.</p>
              <ActionForm action={enrollAction.bind(null, propertySlug)} submitLabel="Connect to Sentire Cloud">
                <Field label="Sentire Cloud address" name="cloudUrl" defaultValue="https://pms.apps.sentire.solutions" required />
                <Field label="Enrollment key" name="enrollKey" type="password" required hint="Sentire gives you this key." />
                <Field label="Name of this hub" name="hubName" defaultValue="Front desk PC" />
                <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="replace" /> This PC replaces the property&apos;s old hub</label>
              </ActionForm>
            </>
          )}
        </Card>
        <Card title="Devices" >
          <div className="mb-3"><ActionForm inline showOk action={pairingCodeAction.bind(null, propertySlug)} submitLabel="Pair a device" /></div>
          {!pairingRequired() && <div className="mb-3"><Notice>Pairing is not enforced on this server (staging). Installed hubs always require it.</Notice></div>}
          <Table head={["Device", "Type", "Paired", "Last seen", ""]} empty={devs.length ? undefined : "No devices paired yet."}>
            {devs.map((d) => (
              <tr key={d.id}>
                <td className="font-semibold">{d.name}</td>
                <td>{KIND[d.kind]}</td>
                <td className="whitespace-nowrap">{formatDateTime(d.createdAt)}</td>
                <td className="whitespace-nowrap">{d.revokedAt ? <Badge status="CANCELLED">Removed</Badge> : formatDateTime(d.lastSeenAt)}</td>
                <td className="text-right">{!d.revokedAt && <ActionForm inline variant="danger" action={revokeDeviceAction.bind(null, propertySlug, d.id)} submitLabel="Remove" confirm={`Remove ${d.name}? It must be paired again to connect.`} />}</td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
      <Card title="Sync issues" className="mt-5">
        <p className="mt-0 text-[13px] text-muted">Changes one side could not apply. Nothing is lost; resolve each one after checking the record.</p>
        <Table head={["When", "Direction", "Record", "Reason", ""]} empty={o.issues.length ? undefined : "No open sync issues."}>
          {o.issues.map((i) => (
            <tr key={i.id}>
              <td className="whitespace-nowrap">{formatDateTime(i.createdAt)}</td>
              <td>{i.direction === "out" ? "To cloud" : "From cloud"}</td>
              <td>{i.entity} <span className="font-mono text-[11px] text-muted">{i.entityId}</span></td>
              <td className="text-[#991b1b]">{i.reason}</td>
              <td className="whitespace-nowrap text-right">
                <span className="inline-flex gap-2">
                  <ActionForm inline variant="secondary" action={issueAction.bind(null, propertySlug, i.id, "RESOLVED")} submitLabel="Resolved" />
                  <ActionForm inline variant="secondary" action={issueAction.bind(null, propertySlug, i.id, "IGNORED")} submitLabel="Ignore" />
                </span>
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
