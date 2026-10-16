import { NextResponse, type NextRequest } from "next/server";
import { createServerDbClient } from "@platform/db";

/**
 * Refresh the Supabase session on every request so expired access tokens get
 * renewed and the refreshed auth cookies ride back on the response.
 *
 * ============================================================================
 * THIS IS NOT THE SECURITY BOUNDARY. NEVER TRUST THE PROXY ALONE.
 * ============================================================================
 * It refreshes tokens. It does not protect anything. Route protection is
 * enforced INSIDE EACH PAGE, by `requireSession()` (src/lib/session.ts), and
 * every protected page calls it itself — see the per-page table in that file's
 * header. A guard that runs here and is then trusted downstream is a guard that
 * fires once and is believed forever; the same failure as trusting a layout,
 * wearing a different hat. If you are tempted to add a redirect below, add it to
 * the pages instead.
 *
 * PORT NOTE — apps/web composes next-intl here (next-intl produces the response
 * FIRST, then updateSession attaches refreshed cookies onto that same response).
 * Cortex has NO i18n middleware to compose with: its locale lives in a cookie
 * read by the root layout, not in the URL. So there is nothing to compose, and
 * this creates its own response with NextResponse.next() rather than receiving
 * one. That is the whole difference.
 */
export default async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return response;

  const supabase = createServerDbClient(url, key, {
    getAll() {
      return request.cookies.getAll();
    },
    setAll(cookiesToSet) {
      cookiesToSet.forEach(({ name, value, options }) =>
        response.cookies.set(name, value, options)
      );
    },
  });

  // Touch the session so expired access tokens get refreshed (and the new
  // cookies are written onto `response` via setAll above).
  await supabase.auth.getUser();

  return response;
}

export const config = {
  // Match all paths except Next internals and files with an extension (static
  // assets, the service worker, the web manifest, icons).
  matcher: "/((?!_next|_vercel|.*\\..*).*)",
};
