// SERVER-ONLY. Importing this module from a Client Component is a build error
// (the `server-only` package guarantees the secret key can never be bundled
// into client JavaScript). This is the only place the web app touches the
// secret/service-role key.
import "server-only";

import { createAdminDbClient } from "@platform/db";

/**
 * Create a privileged Supabase client (secret/service-role key) for trusted
 * server-side admin operations such as creating auth users.
 *
 * SECURITY:
 * - Uses `SUPABASE_SECRET_KEY` (note: NO `NEXT_PUBLIC_` prefix, so Next.js will
 *   never inline it into the client bundle) — read only on the server.
 * - This client BYPASSES Row Level Security. Callers MUST perform their own
 *   authorization check first (re-verify the acting user's permission with the
 *   authenticated client) before using it.
 *
 * Returns `null` when the secret key isn't configured, so callers can surface a
 * graceful "not configured" error instead of crashing.
 */
export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) return null;

  return createAdminDbClient(url, secretKey);
}
