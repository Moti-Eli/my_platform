// SERVER-ONLY. Builds a per-request, user-scoped Supabase client from a Bearer
// token for the mobile-facing admin API routes.
import "server-only";

import { createTokenDbClient, type SupabaseClient } from "@platform/db";

export type ApiAuthResult =
  | { ok: true; client: SupabaseClient; userId: string }
  | { ok: false; status: number; error: string };

/**
 * Authenticate an admin-API request from its `Authorization: Bearer <token>`
 * header. Returns a Supabase client SCOPED TO THAT USER (RLS applies as them),
 * so the caller can run its authorization re-check on it.
 *
 * - Missing env config → 503 `notConfigured`.
 * - No/garbage header, or a token the server can't validate (expired/invalid)
 *   → 401 `unauthorized`. We validate the token server-side via `getUser(token)`
 *   so a forged/expired token is rejected here, before any domain logic runs.
 */
export async function authenticateApiRequest(req: Request): Promise<ApiAuthResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return { ok: false, status: 503, error: "notConfigured" };

  const header = req.headers.get("authorization");
  const match = header ? /^Bearer\s+(.+)$/i.exec(header.trim()) : null;
  const token = match?.[1];
  if (!token) return { ok: false, status: 401, error: "unauthorized" };

  const client = createTokenDbClient(url, key, token);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return { ok: false, status: 401, error: "unauthorized" };

  return { ok: true, client, userId: data.user.id };
}
