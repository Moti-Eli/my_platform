/**
 * @platform/observability
 *
 * A small, VENDOR- and FRAMEWORK-agnostic logging + error-reporting abstraction.
 * App code only ever imports from here — never a vendor SDK directly — so a
 * project spawned from this template can swap or disable the backend by editing a
 * single adapter (see `setErrorReporter`).
 *
 * Behaviour:
 *  - `logger.{debug,info,warn,error}` emit STRUCTURED JSON log lines to the
 *    console (one line per event: level, timestamp, msg, context, [error]).
 *  - `captureException(err, ctx)` logs the error AND forwards it to the
 *    registered error reporter (e.g. a Sentry adapter), if any. With no reporter
 *    registered (the default — e.g. when `SENTRY_DSN` is unset), it is just the
 *    structured console log. Nothing crashes either way.
 *
 * SECURITY: every context object (and error message/stack) is run through
 * `redact()` before it is logged or handed to a reporter, so secrets, tokens,
 * passwords, the Supabase keys, and emails/PII never reach any sink. Callers
 * should still prefer logging IDENTIFIERS (userId, orgId) over sensitive content.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  [key: string]: unknown;
}

export interface Logger {
  /** Log an error (an Error or a message) at error level. */
  error(errorOrMessage: unknown, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  debug(message: string, context?: LogContext): void;
}

/** A pluggable backend for error reporting (e.g. Sentry). */
export type ErrorReporter = (error: unknown, context?: LogContext) => void;

// ---------------------------------------------------------------------------
// Redaction — the single chokepoint that keeps secrets out of every sink.
// ---------------------------------------------------------------------------

/** Property names whose VALUE is always replaced with [redacted] (case-insensitive substring). */
const SENSITIVE_KEYS = [
  "password",
  "passwd",
  "pwd",
  "secret",
  "token",
  "apikey",
  "api_key",
  "authorization",
  "auth_token",
  "accesstoken",
  "access_token",
  "refresh_token",
  "cookie",
  "credential",
  "dsn",
  "service_role",
  "servicerole",
  "jwt",
  "session",
  "email",
  "mail",
];

/** String VALUE patterns that are redacted no matter the key (defense in depth). */
const SENSITIVE_VALUE_PATTERNS: Array<{ re: RegExp; with: string }> = [
  { re: /sb_secret_[A-Za-z0-9_-]+/g, with: "[redacted-secret-key]" },
  { re: /sb_publishable_[A-Za-z0-9_-]+/g, with: "[redacted-key]" },
  { re: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g, with: "[redacted-jwt]" },
  { re: /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, with: "Bearer [redacted]" },
  // Emails are PII — redact the local part, keep the domain for debugging.
  { re: /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, with: "[redacted-email]@$1" },
];

const MAX_STRING = 2000;
const MAX_DEPTH = 6;

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  return SENSITIVE_KEYS.some((s) => k.includes(s));
}

function redactString(value: string): string {
  let out = value;
  for (const { re, with: w } of SENSITIVE_VALUE_PATTERNS) out = out.replace(re, w);
  if (out.length > MAX_STRING) out = `${out.slice(0, MAX_STRING)}…[truncated]`;
  return out;
}

/**
 * Deep-clone `value`, removing anything sensitive. Sensitive KEYS get their value
 * replaced; string VALUES are scrubbed for secret/token/JWT/email patterns.
 */
export function redact(value: unknown, depth = 0, keyHint?: string): unknown {
  if (keyHint && isSensitiveKey(keyHint)) return "[redacted]";
  if (value === null || value === undefined) return value;

  const t = typeof value;
  if (t === "string") return redactString(value as string);
  if (t === "number" || t === "boolean") return value;
  if (t === "bigint") return `${(value as bigint).toString()}n`;
  if (t === "function" || t === "symbol") return undefined;

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: value.stack ? redactString(value.stack) : undefined,
    };
  }

  if (depth >= MAX_DEPTH) return "[max-depth]";

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((v) => redact(v, depth + 1));
  }

  if (t === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(k)) {
        out[k] = "[redacted]";
        continue;
      }
      const r = redact(v, depth + 1, k);
      if (r !== undefined) out[k] = r;
    }
    return out;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Structured console logging.
// ---------------------------------------------------------------------------

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function minLevel(): number {
  const env = typeof process !== "undefined" ? process.env : undefined;
  const configured = env?.LOG_LEVEL?.toLowerCase() as LogLevel | undefined;
  if (configured && configured in LEVEL_WEIGHT) return LEVEL_WEIGHT[configured];
  // Default: debug in non-production, info in production.
  return env?.NODE_ENV === "production" ? LEVEL_WEIGHT.info : LEVEL_WEIGHT.debug;
}

interface LogEntry {
  level: LogLevel;
  timestamp: string;
  msg: string;
  context?: LogContext;
  error?: { name: string; message: string; stack?: string };
}

function toErrorShape(err: unknown): { msg: string; error: LogEntry["error"] } {
  if (err instanceof Error) {
    const r = redact(err) as { name: string; message: string; stack?: string };
    return { msg: r.message, error: r };
  }
  // Error-like objects (e.g. Supabase's PostgrestError) aren't Error instances
  // but do carry a string `message` — preserve it (redacted).
  if (err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string") {
    const e = err as { name?: string; message: string };
    const message = redactString(e.message);
    return { msg: message, error: { name: e.name ?? "Error", message } };
  }
  return { msg: typeof err === "string" ? redactString(err) : "Non-error thrown", error: undefined };
}

function emit(level: LogLevel, msg: string, context?: LogContext, error?: LogEntry["error"]): void {
  if (LEVEL_WEIGHT[level] < minLevel()) return;

  const entry: LogEntry = {
    level,
    timestamp: new Date().toISOString(),
    msg: redactString(msg),
  };
  if (context && Object.keys(context).length > 0) {
    entry.context = redact(context) as LogContext;
  }
  if (error) entry.error = error;

  const line = safeStringify(entry);
  // Route to the matching console method so log levels are honored by hosts.
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else if (level === "debug") console.debug(line);
  else console.info(line);
}

function safeStringify(entry: LogEntry): string {
  try {
    return JSON.stringify(entry);
  } catch {
    // Circular or otherwise unserializable context — fall back to a minimal line.
    return JSON.stringify({ level: entry.level, timestamp: entry.timestamp, msg: entry.msg });
  }
}

export const logger: Logger = {
  error(errorOrMessage: unknown, context?: LogContext): void {
    if (typeof errorOrMessage === "string") {
      emit("error", errorOrMessage, context);
    } else {
      const { msg, error } = toErrorShape(errorOrMessage);
      emit("error", msg, context, error);
    }
  },
  warn(message: string, context?: LogContext): void {
    emit("warn", message, context);
  },
  info(message: string, context?: LogContext): void {
    emit("info", message, context);
  },
  debug(message: string, context?: LogContext): void {
    emit("debug", message, context);
  },
};

// ---------------------------------------------------------------------------
// Error reporting (pluggable backend).
// ---------------------------------------------------------------------------

let errorReporter: ErrorReporter | null = null;

/**
 * Register (or clear, with `null`) the error-reporting backend. The web app
 * calls this from its instrumentation to plug in a Sentry adapter ONLY when
 * `SENTRY_DSN` is configured; otherwise the default (console-only) applies.
 */
export function setErrorReporter(reporter: ErrorReporter | null): void {
  errorReporter = reporter;
}

/** Whether an error-reporting backend is currently registered. */
export function hasErrorReporter(): boolean {
  return errorReporter !== null;
}

/**
 * Capture an exception: always structured-logs it, and forwards it to the
 * registered reporter (if any) with a redacted context. Never throws.
 */
export function captureException(error: unknown, context?: LogContext): void {
  logger.error(error, context);
  if (errorReporter) {
    try {
      errorReporter(error, context ? (redact(context) as LogContext) : undefined);
    } catch (reporterError) {
      logger.error(reporterError, { source: "errorReporter" });
    }
  }
}

export const observabilityVersion = "0.1.0";
