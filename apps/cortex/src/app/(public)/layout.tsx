import type { ReactNode } from "react";

/**
 * The PUBLIC layout — pages anyone can open without signing in (today: a
 * business card at /c/<slug>). Like the `(auth)` layout it renders no app shell:
 * no header, tabs, bottom nav or AI button — a visitor has no session for any of
 * it to mean something. The `(public)` group name changes no url.
 *
 * Nothing here reads identity, and no page in this group may call
 * requireSession(): their data comes only through a deliberately public door
 * (see each page). One centred column, capped like the auth layout.
 */
export default function PublicGroupLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[400px] flex-col justify-center gap-xl px-lg py-xl">
      {children}
    </main>
  );
}
