import type { ReactNode } from "react";
import { Wordmark } from "@/components/shell/Wordmark";

/**
 * The BARE layout — for screens that must not be wrapped in the app shell.
 *
 * Two live here: `/login` (you have no session yet) and `/no-organization` (you
 * have one, but no org). Both would be actively wrong inside AppShell: it renders
 * a header, an app-tabs row of installed tools, a bottom nav and an AI button —
 * an entire product's chrome around a form you must complete BEFORE any of it
 * means anything. It also crushed the form into a ~40px column, which is how we
 * noticed.
 *
 * The `(auth)` group name changes NO url: `/login` is still `/login`.
 *
 * Chrome here is the wordmark and nothing else — no nav, no tabs, no AI button,
 * no bell, no search. It is the same {@link Wordmark} component the shell header
 * renders, not a copy.
 *
 * Layout: one centred column, capped at 400px so the fields stay a comfortable
 * measure on desktop while going full-width on a 375px phone. `min-h-dvh` +
 * `justify-center` centres it vertically, and `py-xl` keeps it off the edges when
 * the viewport is short (or the keyboard is up), because padding on a centred
 * flex column still bounds it once content exceeds the height. Direction is
 * inherited from `<html dir>` — the root layout sets it per locale, so this is
 * RTL in Hebrew without doing anything here.
 */
export default function AuthGroupLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[400px] flex-col justify-center gap-xl px-lg py-xl">
      <div className="flex justify-center">
        <Wordmark />
      </div>
      {children}
    </main>
  );
}
