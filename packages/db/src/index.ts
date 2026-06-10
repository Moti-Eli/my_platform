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
import {
  createClient,
  type SupabaseClient,
  type SupportedStorage,
} from "@supabase/supabase-js";

export const dbVersion = "0.1.0";

/**
 * Re-export the Supabase client type so app code (which depends on @platform/db,
 * not on @supabase/supabase-js directly) can annotate clients without taking a
 * direct dependency on the underlying SDK.
 */
export type { SupabaseClient } from "@supabase/supabase-js";

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

/**
 * Create a Supabase client for use in a native (React Native / Expo) app.
 * Uses the publishable (anon) key, which is safe to expose client-side.
 *
 * Unlike the browser/server clients, this one uses the plain `supabase-js`
 * client (no `@supabase/ssr`, which depends on `document`/cookies that don't
 * exist in React Native).
 *
 * Pass a `storage` adapter (e.g. AsyncStorage) to persist the auth session
 * across app restarts; session persistence and token auto-refresh are then
 * enabled automatically. With no storage adapter the client stays stateless
 * (the original behaviour, suitable for anonymous reads / health checks).
 */
export interface NativeDbClientOptions {
  /** Storage adapter used to persist the auth session (e.g. AsyncStorage). */
  storage?: SupportedStorage;
}

export function createNativeDbClient(
  supabaseUrl: string,
  publishableKey: string,
  options: NativeDbClientOptions = {}
): SupabaseClient {
  const persist = options.storage != null;
  return createClient(supabaseUrl, publishableKey, {
    auth: {
      storage: options.storage,
      persistSession: persist,
      autoRefreshToken: persist,
      // No URL-based session detection in React Native (no browser redirect).
      detectSessionInUrl: false,
    },
  });
}

/**
 * Create a Supabase client scoped to a specific user's access token.
 *
 * Uses the publishable (anon) key but attaches `Authorization: Bearer <token>`
 * to every PostgREST/RPC request, so the database sees the request as that user
 * and **RLS applies as them** — exactly like an authenticated session, but built
 * per-request from a token instead of cookies. This is what a server-side API
 * route handler uses to act on behalf of a mobile client that authenticated with
 * a Bearer token: validate the token (`auth.getUser(token)`), then run RLS-scoped
 * authorization checks through this client.
 *
 * Carries no session (no persistence/refresh): it is a stateless, single-request
 * client. It does NOT bypass RLS — it is the low-privilege, user-scoped counterpart
 * to `createAdminDbClient`.
 */
export function createTokenDbClient(
  supabaseUrl: string,
  publishableKey: string,
  accessToken: string
): SupabaseClient {
  return createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * Create a privileged Supabase client using the SECRET (service-role) key.
 *
 * This client BYPASSES Row Level Security and can perform admin operations such
 * as creating auth users. It is intended ONLY for trusted server-side code
 * (server actions, route handlers, scripts) and must NEVER be constructed in,
 * or have its key exposed to, the browser.
 *
 * It carries no session (no cookies) and never persists/refreshes tokens, so it
 * always acts as `service_role` rather than on behalf of a logged-in user.
 * Callers are responsible for doing their own authorization checks (e.g. via
 * @platform/auth, using a separate authenticated client) BEFORE using this.
 */
export function createAdminDbClient(supabaseUrl: string, secretKey: string): SupabaseClient {
  return createClient(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
