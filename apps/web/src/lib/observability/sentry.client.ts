import * as Sentry from "@sentry/nextjs";
import { setErrorReporter } from "@platform/observability";

/**
 * Sentry BROWSER adapter — the ONE place the app touches the Sentry SDK on the
 * client. Imported (and Sentry initialized) ONLY when `NEXT_PUBLIC_SENTRY_DSN`
 * is set (see `src/instrumentation-client.ts`); otherwise console-only applies.
 */
export function registerSentryClient(): void {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });

  setErrorReporter((error, context) => {
    Sentry.captureException(error, context ? { extra: context } : undefined);
  });
}
