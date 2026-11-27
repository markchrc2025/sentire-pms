import Link from "next/link";
import { redirect } from "next/navigation";
import { isCloud } from "@sentire-pms/core";
import { getDb } from "@sentire-pms/db";
import { hasAnyUser } from "@/server/iam/auth";
import { sentireAccountEnabled } from "@/server/iam/sentire-account";
import { SignInForm } from "./SignInForm";

export const dynamic = "force-dynamic";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  if (!isCloud() && process.env.DATABASE_URL && !(await hasAnyUser(getDb()))) redirect("/setup");
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <section className="w-full max-w-[420px] rounded-card border border-line bg-surface p-8">
        <div className="flex h-11 w-11 items-center justify-center rounded-[10px] bg-tile text-xl font-bold text-white" aria-hidden="true">S</div>
        <h1 className="mb-1 mt-4 text-2xl font-bold">Sign in to Sentire PMS</h1>
        <p className="m-0 text-sm text-muted">Use the email and password your property owner gave you.</p>
        {error && <p role="alert" className="mt-3 text-[13px] text-[#991b1b]">{error}</p>}
        <SignInForm next={next} />
        {sentireAccountEnabled() && (
          <p className="mt-4 text-center text-[13px]"><Link href="/api/auth/sentire/start">Sign in with Sentire Account</Link></p>
        )}
      </section>
    </main>
  );
}
