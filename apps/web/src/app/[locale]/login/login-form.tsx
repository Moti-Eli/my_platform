"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { loginAction, type LoginState } from "./actions";

const initialState: LoginState = { error: null };

export function LoginForm({ locale }: { locale: string }) {
  const t = useTranslations("login");
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-4">
      <input type="hidden" name="locale" value={locale} />

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">{t("email")}</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          className="rounded-lg border border-border bg-card px-3 py-2 text-card-foreground"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">{t("password")}</span>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="rounded-lg border border-border bg-card px-3 py-2 text-card-foreground"
        />
      </label>

      {state.error && (
        <p role="alert" className="text-sm text-[var(--color-error,#ef4444)]">
          {t(state.error)}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60"
      >
        {pending ? t("signingIn") : t("submit")}
      </button>
    </form>
  );
}
