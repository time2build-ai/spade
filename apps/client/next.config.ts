import type { NextConfig } from "next";

const API_BASE = process.env.API_BASE ?? "http://127.0.0.1:8765";

const nextConfig: NextConfig = {
  // Next 16 blocks cross-origin access to /_next/* dev resources by default.
  // The dev origin is "localhost", so requests from 127.0.0.1 get blocked and
  // the client bundle never hydrates. Allow 127.0.0.1 so either host works.
  allowedDevOrigins: ["127.0.0.1"],
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_BASE}/:path*` }];
  },
};

export default nextConfig;
