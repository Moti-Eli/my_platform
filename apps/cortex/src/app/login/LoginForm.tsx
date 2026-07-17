"use client";

import { useActionState } from "react";
import { useI18n } from "@/i18n";
import { loginAction, type LoginState } from "./actions";

const initialState: LoginState = { error: null };

/**
 * The login form. Colours come from the design-system tokens only (screen/card/
 * ink/muted/hairline/accent/on-fill/danger/ring) — no literal colour anywhere —
 * and every string is a dictionary key resolved through `useI18n`.
 *
 * `state.error` is always a `login.*` key, never a server message, so it is
 * translated like any other string. The email/password inputs are forced `dir="ltr"`
 * inside the RTL page, because credentials are not Hebrew text — the same choice
 * apps/web makes.
 */
export function LoginForm() {
  const { t } = useI18n();
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="flex w-full flex-col gap-md">
      <label className="flex flex-col gap-xs text-sm">
        <span className="font-medium text-ink">{t("login.email")}</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          dir="ltr"
          className="rounded-md border border-hairline bg-screen px-md py-sm text-ink transition-colors placeholder:text-muted focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>

      <label className="flex flex-col gap-xs text-sm">
        <span className="font-medium text-ink">{t("login.password")}</span>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          dir="ltr"
          className="rounded-md border border-hairline bg-screen px-md py-sm text-ink transition-colors placeholder:text-muted focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>

      {state.error && (
        <p
          role="alert"
          className="rounded-md border border-danger/40 bg-danger/10 px-md py-sm text-sm text-danger"
        >
          {t(state.error)}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-xs inline-flex items-center justify-center rounded-md bg-accent px-md py-sm text-sm font-semibold text-on-fill transition-all hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100 interactive touch-manipulation"
      >
        {pending ? t("login.signingIn") : t("login.submit")}
      </button>
    </form>
  );
}
