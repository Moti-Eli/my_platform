"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/i18n";
import { CloseIcon } from "@/components/icons";
import { hideOrgAction, type HideOrgState } from "./hide-org.actions";

const initialState: HideOrgState = { error: null, hiddenNonce: null };

/**
 * A minimal per-row "remove" affordance: soft-deletes (hides) one organization
 * via {@link hideOrgAction}. Deliberately minimal — a basic `confirm()`, no
 * restore/undo UI, no styled dialog (all out of scope). The button is disabled
 * while the request is in flight so a double-tap cannot double-submit. On
 * success we `router.refresh()` once (guarded by a nonce ref), re-running the
 * server wrapper so the now-hidden row drops out of the RLS-scoped list.
 */
export function HideOrganization({ orgId, orgName }: { orgId: string; orgName: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [state, formAction, pending] = useActionState(hideOrgAction, initialState);

  const lastHidden = useRef<string | null>(null);
  useEffect(() => {
    if (state.hiddenNonce && state.hiddenNonce !== lastHidden.current) {
      lastHidden.current = state.hiddenNonce;
      router.refresh();
    }
  }, [state.hiddenNonce, router]);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        // Basic confirm only (styled dialog is out of scope). Cancel => no submit.
        if (!window.confirm(t("profile.hideOrgConfirm"))) e.preventDefault();
      }}
    >
      <input type="hidden" name="organizationId" value={orgId} />
      <button
        type="submit"
        disabled={pending}
        aria-label={`${t("profile.hideOrg")} — ${orgName}`}
        title={state.error ? t(state.error) : t("profile.hideOrg")}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted interactive hover:bg-hairline active:bg-hairline disabled:opacity-50 motion-safe:active:scale-[0.97]"
      >
        <CloseIcon width={16} height={16} />
      </button>
    </form>
  );
}
