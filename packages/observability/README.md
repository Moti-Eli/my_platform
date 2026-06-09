# @platform/observability

Vendor- and framework-agnostic **logging + error-reporting** abstraction. App code
imports only from here — never a vendor SDK directly — so the backend can be
swapped or disabled by editing a single adapter. Mirrors how `@platform/db`
abstracts Supabase.

## API

```ts
import { logger, captureException, setErrorReporter } from "@platform/observability";

logger.info("member added", { orgId, actorId });      // structured JSON line
logger.warn("slow query", { ms: 1200 });
logger.debug("cache hit", { key });
logger.error(err, { action: "addMember" });            // takes an Error or a string

captureException(err, { action: "addMember", orgId }); // logs + forwards to reporter
```

- `logger.{debug,info,warn,error}` write **structured JSON log lines** to the
  console (`level`, `timestamp`, `msg`, `context`, and `error` for errors). The
  minimum level honors `LOG_LEVEL` (default: `debug` off-prod, `info` in prod).
- `captureException(err, context?)` logs the error **and** forwards it to the
  registered `ErrorReporter`. With no reporter (the default), it's just the log.

## Pluggable backend

`setErrorReporter(reporter | null)` plugs in a backend. The web app registers a
**Sentry** adapter from its instrumentation **only when `SENTRY_DSN` is set**;
otherwise the default console-only behavior applies. To use a different vendor,
write one `ErrorReporter` and register it — no app code changes.

## Security — redaction

Every context object and error message/stack passes through `redact()` before any
sink, scrubbing:

- sensitive **keys** (password, token, secret, authorization, cookie, dsn,
  service_role, jwt, session, email, …) → `[redacted]`
- sensitive **values** (Supabase `sb_secret_…`/`sb_publishable_…` keys, JWTs,
  `Bearer …`, email local-parts) → redacted regardless of key.

Still prefer logging **identifiers** (`userId`, `orgId`) over sensitive content.
