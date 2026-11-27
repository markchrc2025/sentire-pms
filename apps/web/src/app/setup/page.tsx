import { notFound, redirect } from "next/navigation";
import { isCloud } from "@sentire-pms/core";
import { getDb } from "@sentire-pms/db";
import { hasAnyUser } from "@/server/iam/auth";
import { SetupForm } from "./SetupForm";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (isCloud()) notFound();
  if (await hasAnyUser(getDb())) redirect("/sign-in");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <section className="w-full max-w-[560px] rounded-card border border-line bg-surface p-8">
        <h1 className="m-0 text-2xl font-bold">Set up this hub</h1>
        <p className="m-0 mt-1 text-sm text-muted">Create your company, your first property and the owner account. You can add rooms and staff after this.</p>
        <SetupForm today={today} />
      </section>
    </main>
  );
}
