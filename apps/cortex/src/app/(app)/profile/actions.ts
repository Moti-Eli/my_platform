"use server";

import { redirect } from "next/navigation";
import { signOut } from "@platform/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Sign the user out and return to /login. Mirrors login/actions.ts's shape.
 *
 * HOW THE COOKIES ACTUALLY CLEAR — `signOut()` calls
 * `supabase.auth.signOut()`, which (a) invalidates the session server-side and
 * (b) drives the RLS-scoped server client's cookie adapter to REMOVE the auth
 * cookies. That removal is a `cookieStore.set(name, "", { maxAge: 0 })` in
 * `lib/supabase/server.ts`'s `setAll`. In a SERVER ACTION that write is permitted
 * and Next flushes it onto the response as `Set-Cookie`, so the browser drops the
 * session on this very response — the same cookie plumbing proxy.ts uses for
 * refresh. (server.ts's `try/catch` there swallows only the Server-Component-
 * render case, where `set` throws; a server action is not that case.)
 *
 * No raw error is ever surfaced (the task's rule, and login/actions.ts's shape).
 * signOut's only realistic failure leaves a stale LOCAL session, which
 * requireSession() rejects on the next request anyway — there is nothing
 * actionable to render — so we redirect regardless. If the client is somehow
 * unconfigured, redirecting to /login is still the correct, safe outcome.
 */
export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  if (supabase) await signOut(supabase);
  redirect("/login");
}
