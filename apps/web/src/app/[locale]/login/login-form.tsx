"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { loginAction, type LoginState } from "./actions";

const initialState: LoginState = { error: null };

export function LoginForm({ locale }: { locale: string }) {
  const t = useTranslations("login");
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="flex w-full flex-col gap-5">
      <input type="hidden" name="locale" value={locale} />

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">{t("email")}</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          dir="ltr"
          className="rounded-lg border border-border bg-background px-3 py-2.5 text-card-foreground transition-colors placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">{t("password")}</span>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          dir="ltr"
          className="rounded-lg border border-border bg-background px-3 py-2.5 text-card-foreground transition-colors placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        />
      </label>

      {state.error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {t(state.error)}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100"
      >
        {pending ? t("signingIn") : t("submit")}
      </button>
    </form>
  );
}
