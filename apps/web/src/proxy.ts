import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { updateSession } from "./lib/supabase/middleware";

// Next.js 16 renamed the `middleware` convention to `proxy` (nodejs runtime).
// We compose two concerns: next-intl handles locale detection/prefixing and
// produces the response; then updateSession refreshes the Supabase session and
// attaches any refreshed auth cookies onto that same response.
const handleI18n = createMiddleware(routing);

export default async function proxy(request: NextRequest) {
  const response = handleI18n(request);
  return updateSession(request, response);
}

export const config = {
  // Match all paths except API routes, Next internals, and files with an
  // extension (e.g. static assets).
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};
