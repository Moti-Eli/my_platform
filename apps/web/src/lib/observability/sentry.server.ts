import "server-only";
import * as Sentry from "@sentry/nextjs";
import { logger, setErrorReporter } from "@platform/observability";

/**
 * Sentry SERVER adapter — the ONE place the app touches the Sentry SDK on the
 * server. It is imported (and Sentry initialized) ONLY when `SENTRY_DSN` is set
 * (see `src/instrumentation.ts`); otherwise the default console reporter applies.
 * To use a different vendor, replace this file's body — no app code changes.
 */
export function registerSentryServer(): void {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    // Off by default; the app opts into tracing via env when it wants it.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0"),
    // We never want Sentry attaching IPs/cookies/PII automatically — our
    // abstraction already redacts context before it reaches here.
    sendDefaultPii: false,
  });

  setErrorReporter((error, context) => {
    Sentry.captureException(error, context ? { extra: context } : undefined);
  });

  logger.info("observability: Sentry server adapter active");
}
