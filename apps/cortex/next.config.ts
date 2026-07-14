import type { NextConfig } from "next";

// Cortex shell is self-contained for now (no shared @platform/* packages
// consumed yet — the AI stub will wire to @platform/cortex-core's runIntent in a
// later prompt, at which point this app adds it to `transpilePackages`).
const nextConfig: NextConfig = {};

export default nextConfig;
