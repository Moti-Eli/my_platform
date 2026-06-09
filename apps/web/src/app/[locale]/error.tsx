"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { captureException } from "@platform/observability";
import { Link } from "@/i18n/navigation";

/**
 * Route-segment error boundary. The technical details (message/stack/digest) are
 * sent ONLY to the logger via captureException — NEVER rendered to the user, who
 * sees a calm, translated, themed state with a retry action.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("error");

  useEffect(() => {
    captureException(error, { boundary: "route", digest: error.digest });
  }, [error]);

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden px-6">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute start-1/2 top-[38%] size-[34rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-destructive/10 blur-[120px] rtl:translate-x-1/2" />
      </div>

      <div className="flex max-w-md flex-col items-center text-center">
        <span
          className="fade-rise grid size-16 place-items-center rounded-2xl bg-destructive/10 text-destructive ring-1 ring-inset ring-destructive/20"
          style={{ animationDelay: "0ms" }}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="size-8">
            <path
              d="M12 9v4m0 4h.01M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.4 0Z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>

        <h1
          className="fade-rise mt-6 text-balance text-2xl font-bold tracking-tight text-foreground"
          style={{ animationDelay: "70ms" }}
        >
          {t("title")}
        </h1>
        <p
          className="fade-rise mt-2 max-w-sm text-pretty text-sm leading-relaxed text-muted-foreground"
          style={{ animationDelay: "140ms" }}
        >
          {t("description")}
        </p>

        <div
          className="fade-rise mt-7 flex flex-wrap items-center justify-center gap-2.5"
          style={{ animationDelay: "210ms" }}
        >
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-[0.98]"
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="size-4">
              <path d="M10 3a7 7 0 1 0 6.32 4 .75.75 0 0 0-1.36.64A5.5 5.5 0 1 1 10 4.5c.78 0 1.52.16 2.19.46l-1.3 1.29a.75.75 0 0 0 .53 1.28h3.33a.75.75 0 0 0 .75-.75V3.45a.75.75 0 0 0-1.28-.53l-.93.93A6.97 6.97 0 0 0 10 3Z" />
            </svg>
            {t("retry")}
          </button>
          <Link
            href="/"
            className="rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {t("goHome")}
          </Link>
        </div>
      </div>
    </main>
  );
}
