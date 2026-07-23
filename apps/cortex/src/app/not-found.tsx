/**
 * The 404 screen for unmatched URLs — at the ROOT of app/, deliberately: Next
 * cannot know which route group an unmatched URL belongs to, so it renders the
 * root not-found inside the ROOT layout only. AppShell is therefore NOT mounted
 * (no header, no chips row, no TabBar), which is why — unlike (app)/error.tsx —
 * this screen carries its own way back: the home Link below.
 *
 * A SERVER component, for the same reason (app)/loading.tsx is one: no state,
 * no effects, zero client JS. The locale resolves the way the root layout
 * already does (LANG_COOKIE → isLocale → defaultLocale) and text comes from
 * `translate` directly — `useI18n` is a client hook and has no place here.
 *
 * Same calm register as the error screen: this is a wrong address, not a
 * failure.
 */
import Link from "next/link";
import { cookies } from "next/headers";
import { EmptyState } from "@/components/EmptyState";
import { SearchIcon } from "@/components/icons";
import { defaultLocale, dictionaries, isLocale, translate } from "@/i18n";
import { LANG_COOKIE } from "@/lib/cookies";

export default async function NotFound() {
  const cookieStore = await cookies();
  const localeCookie = cookieStore.get(LANG_COOKIE)?.value;
  const locale = isLocale(localeCookie) ? localeCookie : defaultLocale;
  const messages = dictionaries[locale];

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-md p-md">
      <div className="w-full max-w-[480px]">
        <EmptyState
          icon={<SearchIcon />}
          title={translate(messages, "notFound.title")}
          hint={translate(messages, "notFound.hint")}
        />
      </div>
      {/* The same pill accent action as (app)/error.tsx's retry button, so the
          two screens read as one family — but a Link, because with no TabBar
          mounted this IS the navigation. */}
      <Link
        href="/"
        className="self-center rounded-pill bg-accent px-lg py-sm type-label text-on-fill touch-manipulation interactive motion-safe:active:scale-[0.97]"
      >
        {translate(messages, "notFound.action")}
      </Link>
    </main>
  );
}
