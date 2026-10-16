"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/i18n";
import { CloseIcon } from "@/components/icons";
import { removeOrgAction, type RemoveOrgState } from "./remove-org.actions";

const initialState: RemoveOrgState = { error: null, hiddenNonce: null };

/**
 * A per-row "remove" affordance that removes one organization from the caller's
 * list. The server action ({@link removeOrgAction}) decides the branch — HIDE a
 * solo org (reversible) or LEAVE a shared one — so this component is
 * branch-agnostic: one confirm, one button, one error line.
 *
 * It WRAPS the row's switch control (`children`) so the two can be laid out as a
 * column: the switch + remove button on top, and — when the action refuses — the
 * mapped, human-readable error beneath the org name (never a raw code). The error
 * is cleared the moment a new attempt is in flight.
 *
 * The button is disabled while pending so a double-tap cannot double-submit. On
 * success we `router.refresh()` once (nonce-guarded), re-running the server
 * wrapper so the now-gone row drops out of the RLS-scoped list.
 */
export function RemoveOrganization({
  orgId,
  orgName,
  children,
}: {
  orgId: string;
  orgName: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [state, formAction, pending] = useActionState(removeOrgAction, initialState);

  const lastHidden = useRef<string | null>(null);
  useEffect(() => {
    if (state.hiddenNonce && state.hiddenNonce !== lastHidden.current) {
      lastHidden.current = state.hiddenNonce;
      router.refresh();
    }
  }, [state.hiddenNonce, router]);

  return (
    <div className="flex flex-col gap-2xs rounded-lg pe-2xs">
      <div className="flex items-center gap-2xs">
        {children}
        <form
          action={formAction}
          onSubmit={(e) => {
            // Basic confirm only (styled dialog is out of scope). Cancel => no submit.
            if (!window.confirm(t("profile.removeOrgConfirm"))) e.preventDefault();
          }}
        >
          <input type="hidden" name="organizationId" value={orgId} />
          <button
            type="submit"
            disabled={pending}
            aria-label={`${t("profile.hideOrg")} — ${orgName}`}
            title={t("profile.hideOrg")}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted interactive hover:bg-hairline active:bg-hairline disabled:opacity-50 motion-safe:active:scale-[0.97]"
          >
            <CloseIcon width={16} height={16} />
          </button>
        </form>
      </div>
      {/* Refusal surfaced on screen (was silently swallowed). Cleared while a new
          attempt is pending, then re-shown if that attempt also refuses. */}
      {!pending && state.error ? (
        <p className="px-md pb-2xs type-label text-danger">{t(state.error)}</p>
      ) : null}
    </div>
  );
}
