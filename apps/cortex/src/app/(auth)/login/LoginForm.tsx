"use client";

import { useActionState } from "react";
import { useI18n } from "@/i18n";
import { InfoIcon } from "@/components/icons";
import { loginAction, type LoginState } from "./actions";

const initialState: LoginState = { error: null };

/**
 * The login form.
 *
 * EVERYTHING FROM THE DESIGN SYSTEM. Colour, radius, spacing and type are tokens
 * only — there is no literal value here. Two rules that are easy to miss and that
 * this file previously broke:
 *   - TYPE IS A CLOSED SET. globals.css does `--text-*: initial`, so `text-sm` /
 *     `text-xl` resolve to NOTHING; only the `.type-*` roles work, and each
 *     carries its own weight (never pair one with `font-semibold`).
 *   - PRESSABLES USE `.interactive`. It supplies the hover overlay, the pressed
 *     state, the `:focus-visible` ring in the `ring` token, and disabled handling.
 *     Hand-rolling `hover:opacity-90` + `focus-visible:ring-2` reimplements it,
 *     worse, and on a different surface.
 *
 * INPUTS OPT IN TO FOCUS DELIBERATELY. globals.css excludes text inputs from
 * `.interactive` by default so they read as part of their container — and says an
 * input that needs a ring opts in "like anything else". These do: a login field
 * with no visible focus state is unusable by keyboard, so each carries
 * `.interactive`, which gives it the same token ring as every other control.
 *
 * SIZING: fields are `w-full` (they previously had no width at all and collapsed
 * to their content) and `min-h-11` — ~44px, the accessible tap target — so they
 * are real fields at 375px and unchanged on desktop.
 *
 * Credentials are `dir="ltr"` inside the RTL page: an email address is not
 * Hebrew text. `text-start` keeps them reading from the correct edge.
 */
export function LoginForm() {
  const { t } = useI18n();
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  const fieldClass =
    "min-h-11 w-full rounded-md bg-card px-sm py-xs type-body text-ink outline-none placeholder:text-muted interactive";

  return (
    <form action={formAction} className="flex w-full flex-col gap-md">
      <label className="flex flex-col gap-2xs">
        <span className="type-label text-muted">{t("login.email")}</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          dir="ltr"
          className={`${fieldClass} text-start`}
        />
      </label>

      <label className="flex flex-col gap-2xs">
        <span className="type-label text-muted">{t("login.password")}</span>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          dir="ltr"
          className={`${fieldClass} text-start`}
        />
      </label>

      {/*
       * The error is ANNOUNCED, not just coloured. `role="alert"` (an implicit
       * aria-live="assertive") makes a screen reader speak it the moment it
       * appears, and the icon + text carry the meaning independently of the
       * `danger` colour — so it survives colour-blindness and a greyscale screen.
       * `state.error` is always a `login.*` key, never a server message, so it is
       * translated like every other string.
       */}
      {state.error ? (
        <p
          role="alert"
          className="flex items-start gap-xs rounded-md bg-danger/10 px-sm py-xs type-label text-danger"
        >
          <InfoIcon width={18} height={18} aria-hidden className="mt-2xs shrink-0" />
          <span>{t(state.error)}</span>
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="min-h-11 w-full rounded-md bg-accent px-md py-xs type-heading text-on-fill interactive touch-manipulation motion-safe:active:scale-[0.97]"
      >
        {pending ? t("login.signingIn") : t("login.submit")}
      </button>
    </form>
  );
}
