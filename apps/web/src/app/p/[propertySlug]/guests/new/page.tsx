import { Card, Notice, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/ui/ActionForm";
import { requireTenant } from "@/server/iam/request";
import { can } from "@/server/iam/tenant";
import { newGuestAction } from "../actions";
import { GuestFields } from "../GuestFields";

export default async function NewGuestPage({ params }: { params: Promise<{ propertySlug: string }> }) {
  const { propertySlug } = await params;
  const ctx = await requireTenant(propertySlug);
  if (!can(ctx, "guests.manage")) return <Notice kind="warn">Your role cannot add guests.</Notice>;
  return (
    <>
      <PageHeader title="New guest" />
      <Card className="max-w-[760px]">
        <ActionForm action={newGuestAction.bind(null, propertySlug)} submitLabel="Add guest">
          <GuestFields />
        </ActionForm>
      </Card>
    </>
  );
}
