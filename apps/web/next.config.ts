import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Shared workspace packages ship raw TypeScript source, so Next must
  // transpile them rather than expecting pre-built output.
  transpilePackages: [
    "@platform/config",
    "@platform/i18n",
    "@platform/db",
    "@platform/ui",
  ],
};

export default withNextIntl(nextConfig);
