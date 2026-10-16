import { cookies } from "next/headers";
import { createServerDbClient } from "@platform/db";

/**
 * Create a Supabase client for server-side use (server components, server
 * actions, the proxy). Reads/writes session cookies via the Next.js cookie store.
 *
 * Returns `null` when Supabase env vars are absent, so callers can render a
 * graceful "not configured" state instead of crashing the build/page. Mirrors
 * apps/web's wrapper exactly — the factory itself lives in @platform/db, which
 * is the only place that imports @supabase/*.
 */
export async function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;

  const cookieStore = await cookies();

  return createServerDbClient(url, key, {
    getAll() {
      return cookieStore.getAll();
    },
    setAll(cookiesToSet) {
      try {
        cookiesToSet.forEach(({ name, value, options }) =>
          cookieStore.set(name, value, options)
        );
      } catch {
        // `set` throws when called from a Server Component render; session
        // refresh is handled in the proxy, so this can be safely ignored.
      }
    },
  });
}
