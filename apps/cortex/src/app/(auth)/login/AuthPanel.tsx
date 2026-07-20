"use client";

import { useState } from "react";
import { useI18n } from "@/i18n";
import { LoginTitle } from "./LoginTitle";
import { LoginForm } from "./LoginForm";
import { SignupForm } from "./SignupForm";

/**
 * Owns the login⇄signup mode of the (only) public page. A client component
 * because the toggle is local state and every child needs `useI18n`.
 *
 * Design system, unchanged: the heading mirrors {@link LoginTitle}'s exact markup
 * so both modes share one visual header; the toggle is a real `<button>` (this is
 * a mode switch, not navigation — there is no other URL) styled with `.interactive`
 * and a quiet type-label / text-muted look, no bespoke pressable styling.
 */
export function AuthPanel() {
  const { t } = useI18n();
  const [mode, setMode] = useState<"login" | "signup">("login");

  return (
    <div className="flex flex-col gap-lg">
      {mode === "login" ? (
        <LoginTitle />
      ) : (
        <header className="flex flex-col gap-2xs text-center">
          <h1 className="type-title text-ink">{t("signup.title")}</h1>
          <p className="type-body text-muted">{t("signup.subtitle")}</p>
        </header>
      )}

      {mode === "login" ? <LoginForm /> : <SignupForm />}

      <button
        type="button"
        onClick={() => setMode((m) => (m === "login" ? "signup" : "login"))}
        className="type-label text-muted interactive rounded-md px-sm py-xs text-center"
      >
        {mode === "login" ? t("signup.switchToSignup") : t("signup.switchToLogin")}
      </button>
    </div>
  );
}
