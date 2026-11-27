import Link from "next/link";
import { getDb } from "@sentire-pms/db";
import { Card, LinkButton, PageHeader, Table } from "@/components/ui";
import { requireTenant } from "@/server/iam/request";
import { can } from "@/server/iam/tenant";
import { searchGuests } from "@/server/guests";

export const dynamic = "force-dynamic";

export default async function GuestsPage({ params, searchParams }: { params: Promise<{ propertySlug: string }>; searchParams: Promise<{ q?: string }> }) {
  const { propertySlug } = await params;
  const { q = "" } = await searchParams;
  const ctx = await requireTenant(propertySlug);
  const rows = await searchGuests(getDb(), ctx, q, 100);
  const base = `/p/${propertySlug}/guests`;
  return (
    <>
      <PageHeader title="Guests" actions={can(ctx, "guests.manage") ? <LinkButton variant="primary" href={`${base}/new`}>New guest</LinkButton> : undefined} />
      <Card>
        <form action={base} className="mb-3 flex gap-2">
          <label className="sr-only" htmlFor="gq">Search guests</label>
          <input id="gq" name="q" defaultValue={q} placeholder="Name, email or mobile" className="h-9 w-[300px] rounded-control border border-line px-2.5 text-[13px]" />
          <button className="h-9 rounded-control border border-line px-3 text-[13px] font-semibold">Search</button>
        </form>
        <Table head={["Name", "Email", "Mobile", "Nationality", "Company"]} empty={rows.length ? undefined : "No guests found."}>
          {rows.map((g) => (
            <tr key={g.id}>
              <td><Link href={`${base}/${g.id}`} className="font-semibold">{g.lastName}, {g.firstName}</Link></td>
              <td>{g.email}</td>
              <td>{g.mobile}</td>
              <td>{g.nationality}</td>
              <td>{g.company}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
