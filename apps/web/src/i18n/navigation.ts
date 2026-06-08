import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

/**
 * Locale-aware navigation helpers. `usePathname` returns the path WITHOUT the
 * locale prefix, and `<Link locale="...">` switches locale while preserving the
 * current path.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
