// SERVER-ONLY. The app's absolute origin, for links that leave the app
// (a candidate's portal link, a business card's public page and its QR).
import "server-only";

import { headers } from "next/headers";

/**
 * The env override wins when set (e.g. a canonical public URL behind a proxy);
 * otherwise the request origin is reconstructed from its headers. Call it per
 * request — it reads request headers.
 */
export async function getBaseUrl(): Promise<string> {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (envUrl) return envUrl.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}
