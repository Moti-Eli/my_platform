import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @platform/cortex-core ships raw TypeScript source, so Next must transpile it.
  transpilePackages: ["@platform/cortex-core"],
};

export default nextConfig;
