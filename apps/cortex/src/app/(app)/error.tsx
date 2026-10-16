"use client";

/**
 * Route-level error boundary for every screen in the `(app)` group.
 *
 * BODY ONLY. This renders as the children of (app)/layout.tsx — AppShell's
 * header, chips row and bottom TabBar are all still mounted and still work — so
 * this file renders just the screen body, exactly like (app)/loading.tsx. No
 * chrome of its own, and no "back to home" link: the TabBar already provides
 * navigation out.
 *
 * A CLIENT component because Next requires error boundaries to be client
 * components (they hold the reset closure). The error itself is logged once to
 * the console for diagnosis and NEVER rendered — the user gets the calm i18n
 * text only, not a crash dump.
 */
import { startTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { InfoIcon } from "@/components/icons";
import { useI18n } from "@/i18n";

export default function AppGroupError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section className="flex flex-col gap-md">
      <EmptyState icon={<InfoIcon />} title={t("error.title")} hint={t("error.hint")} />
      <button
        type="button"
        // reset() alone re-renders the boundary against the SAME cached RSC
        // payload — for a Server Component error that fails again immediately.
        // router.refresh() re-fetches the server payload first, and reset()
        // then re-renders against the fresh one; the shared transition keeps
        // them as a single update. NOT redundant — do not remove the refresh.
        onClick={() =>
          startTransition(() => {
            router.refresh();
            reset();
          })
        }
        className="self-center rounded-pill bg-accent px-lg py-sm type-label text-on-fill touch-manipulation interactive motion-safe:active:scale-[0.97]"
      >
        {t("error.retry")}
      </button>
    </section>
  );
}
