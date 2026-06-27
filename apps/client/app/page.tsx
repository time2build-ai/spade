/**
 * Home route. In the reference, `/` is the full-bleed cross-project dashboard
 * (sidebar hidden via `home-mode`). The rich dashboard content is built in a
 * later PLAN-V2 PR; this is the placeholder so `home-mode` is reachable now and
 * the shell can hide the sidebar.
 */
export default function Home() {
  return (
    <div data-testid="home-root" style={{ padding: "40px 48px", color: "var(--text-3)" }}>
      <h1 style={{ color: "var(--text)", fontSize: 24, fontWeight: 600, letterSpacing: "-0.02em" }}>
        Home
      </h1>
      <p style={{ marginTop: 8, fontSize: 13 }}>
        Cross-project dashboard — coming in a later parity PR. The sidebar is
        hidden here (full-bleed home mode).
      </p>
    </div>
  );
}
