"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import { InfoIcon } from "@/components/icons";
import { ORG_COOKIE, setPreferenceCookie } from "@/lib/cookies";
import { createOrgAction, type CreateOrgState } from "./create-org.actions";

const initialState: CreateOrgState = { error: null, createdOrgId: null };

/**
 * Create a new ROOT organization, sitting next to the switcher — creating an org
 * belongs where switching org already is. A plain input + button: no onboarding,
 * no confirmation dialog, no icon (all deliberately out of scope).
 *
 * Mirrors {@link SignupForm}'s design-system usage exactly — the closed `.type-*`
 * set, `.interactive` on the input/button, colour/radius/spacing tokens only, and
 * the same `useActionState` + translated-error shape. `pending` disables the
 * in-flight submit so a double-tap cannot create two orgs; the trimmed-empty guard
 * blocks an empty (or whitespace-only) name. On success creation ACTIVATES the new
 * org: we write the active-org cookie and do a FULL page load to "/", using the
 * SAME mechanics as OrganizationsScreen.switchTo. The full load (not router.refresh)
 * is deliberate — the react-query cache is not org-scoped, so a soft refresh would
 * leave the previous org's cached data in place; a full navigation drops it.
 */
export function CreateOrganization() {
  const { t } = useI18n();
  const [state, formAction, pending] = useActionState(createOrgAction, initialState);
  const [name, setName] = useState("");

  // Activate the new org once per successful create. The id is fresh each time, so
  // back-to-back creates each switch exactly once; the ref guards against re-running
  // for the same result on unrelated re-renders.
  const lastCreated = useRef<string | null>(null);
  useEffect(() => {
    if (state.createdOrgId && state.createdOrgId !== lastCreated.current) {
      lastCreated.current = state.createdOrgId;
      setPreferenceCookie(ORG_COOKIE, state.createdOrgId);
      window.location.assign("/");
    }
  }, [state.createdOrgId]);

  const fieldClass =
    "min-h-11 w-full rounded-md bg-card px-sm py-xs type-body text-ink outline-none placeholder:text-muted interactive";
  const canSubmit = name.trim().length > 0 && !pending;

  return (
    <form action={formAction} className="flex w-full flex-col gap-sm">
      <h2 className="type-label text-muted">{t("profile.createOrgTitle")}</h2>

      <input
        name="organizationName"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("profile.createOrgPlaceholder")}
        aria-label={t("profile.createOrgPlaceholder")}
        className={fieldClass}
      />

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
        disabled={!canSubmit}
        className="min-h-11 w-full rounded-md bg-accent px-md py-xs type-heading text-on-fill interactive touch-manipulation motion-safe:active:scale-[0.97]"
      >
        {pending ? t("profile.createOrgSubmitting") : t("profile.createOrgSubmit")}
      </button>
    </form>
  );
}
