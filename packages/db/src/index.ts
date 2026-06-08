/**
 * @platform/db
 * Database layer: Supabase client factories, schema, and migrations.
 *
 * These factories are intentionally framework-agnostic. Apps pass in their own
 * config (URL + key) and, for the server client, a cookie adapter — so this
 * package never imports `next/*` or any app-specific code (apps depend on
 * packages, not the other way around).
 */
import {
  createBrowserClient,
  createServerClient,
  type CookieMethodsServer,
} from "@supabase/ssr";

export const dbVersion = "0.1.0";

/**
 * Create a Supabase client for use in the browser (client components).
 * Uses the publishable (anon) key, which is safe to expose client-side.
 */
export function createBrowserDbClient(supabaseUrl: string, publishableKey: string) {
  return createBrowserClient(supabaseUrl, publishableKey);
}

/**
 * Create a Supabase client for server-side use (server components, route
 * handlers, proxy). The caller supplies a cookie adapter (e.g. wrapping the
 * Next.js `cookies()` store) so session cookies can be read and refreshed.
 */
export function createServerDbClient(
  supabaseUrl: string,
  publishableKey: string,
  cookies: CookieMethodsServer
) {
  return createServerClient(supabaseUrl, publishableKey, { cookies });
}
