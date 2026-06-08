"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { updateMemberRoleAction, type RoleActionState } from "./actions";

const initialState: RoleActionState = { error: null };

type Role = "admin" | "member";

export function RoleSelect({
  membershipId,
  orgId,
  currentRole,
  locale,
}: {
  membershipId: string;
  orgId: string;
  currentRole: Role;
  locale: string;
}) {
  const t = useTranslations("members");
  const [state, formAction, pending] = useActionState(updateMemberRoleAction, initialState);
  const [value, setValue] = useState<Role>(currentRole);
  const wasPending = useRef(false);

  // If a change was rejected (e.g. last-admin guard or RLS), snap the control
  // back to the member's real role once the submission settles.
  useEffect(() => {
    if (wasPending.current && !pending && state.error) {
      setValue(currentRole);
    }
    wasPending.current = pending;
  }, [pending, state.error, currentRole]);

  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="membershipId" value={membershipId} />
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="locale" value={locale} />
      <div className="relative">
        <select
          name="targetRole"
          aria-label={t("changeRole")}
          value={value}
          disabled={pending}
          onChange={(event) => {
            setValue(event.currentTarget.value as Role);
            event.currentTarget.form?.requestSubmit();
          }}
          className="appearance-none rounded-lg border border-border bg-card py-1.5 pe-8 ps-3 text-sm text-card-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60"
        >
          <option value="admin">{t("roleAdmin")}</option>
          <option value="member">{t("roleMember")}</option>
        </select>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="pointer-events-none absolute end-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        >
          <path
            fillRule="evenodd"
            d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </div>
      {state.error ? (
        <span role="alert" className="text-start text-xs text-destructive">
          {t(state.error)}
        </span>
      ) : null}
    </form>
  );
}
