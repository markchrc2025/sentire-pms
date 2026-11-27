import { pmsMode } from "@sentire-pms/core";
import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

export default function Home() {
  const mode = pmsMode();
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <section
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-card)",
          padding: 32,
          maxWidth: 480,
          width: "100%",
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            background: "var(--tile)",
            color: "#fff",
            fontWeight: 700,
            fontSize: 20,
            display: "grid",
            placeItems: "center",
          }}
          aria-hidden="true"
        >
          S
        </div>
        <h1 style={{ fontSize: 24, margin: "16px 0 4px" }}>Sentire PMS</h1>
        <p style={{ margin: 0, color: "var(--muted)" }}>
          {mode === "hub" ? "Property hub" : "Sentire Cloud"}, version {APP_VERSION}. Foundations in progress.
        </p>
        <p style={{ marginTop: 16, fontSize: 14 }}>
          <a href="/api/health">Health check</a>
        </p>
      </section>
    </main>
  );
}
