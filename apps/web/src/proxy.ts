import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

// Next.js 16 renamed the `middleware` convention to `proxy` (nodejs runtime).
// next-intl's middleware factory runs fine here and handles locale detection,
// prefixing, and redirecting "/" to the default locale.
export default createMiddleware(routing);

export const config = {
  // Match all paths except API routes, Next internals, and files with an
  // extension (e.g. static assets).
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};
