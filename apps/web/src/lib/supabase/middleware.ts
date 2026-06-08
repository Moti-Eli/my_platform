import type { NextRequest, NextResponse } from "next/server";
import { createServerDbClient } from "@platform/db";

/**
 * Refresh the Supabase session for the incoming request and write any refreshed
 * auth cookies onto the given response (which has already been produced by the
 * next-intl middleware). This keeps tokens current across requests.
 *
 * NOTE: this only refreshes the session — route protection itself is enforced
 * in the protected pages via `getCurrentUser` (never trust middleware alone).
 */
export async function updateSession(
  request: NextRequest,
  response: NextResponse
): Promise<NextResponse> {
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
