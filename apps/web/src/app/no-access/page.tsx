export default function NoAccess() {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <section className="max-w-[420px] rounded-card border border-line bg-surface p-8">
        <h1 className="m-0 text-xl font-bold">No property yet</h1>
        <p className="text-sm text-muted">Your account is not linked to any property. Ask your property owner to add you.</p>
        <form action="/sign-out" method="post"><button className="text-[13px] text-accent underline" type="submit">Sign out</button></form>
      </section>
    </main>
  );
}
