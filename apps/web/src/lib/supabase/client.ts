import { createBrowserDbClient } from "@platform/db";

/**
 * Create a Supabase client for use in the browser (client components).
 * Uses the publishable key, which is safe to expose client-side.
 */
export function createSupabaseBrowserClient() {
  return createBrowserDbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );
}
