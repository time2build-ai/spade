import type { NextConfig } from "next";

const API_BASE = process.env.API_BASE ?? "http://127.0.0.1:8765";

const nextConfig: NextConfig = {
  // Next 16 blocks cross-origin access to /_next/* dev resources by default.
  // The dev origin is "localhost", so requests from 127.0.0.1 get blocked and
  // the client bundle never hydrates. Allow 127.0.0.1 so either host works.
  allowedDevOrigins: ["127.0.0.1"],
  experimental: {
    // The /api rewrite proxies to the FastAPI backend. Next's dev proxy defaults
    // to a 30s timeout (proxy-request.js: `proxyTimeout || 30000`), so a long
    // Ask turn — the orchestrator building a brain + backlog can run 30–90s+ —
    // gets a plain 500 "Internal Server Error" from the PROXY even though the
    // backend is still working and finishes. Raise it just above the server's
    // 300s prompt timeout so the proxy waits for the real response. (ms)
    proxyTimeout: 310_000,
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_BASE}/:path*` }];
  },
};

export default nextConfig;
