"use client";

/**
 * The list's two occasional actions, opened from the ☰ menu in the floating
 * bar (ShoppingBar.tsx):
 *
 *   Rename list — the list's name in `shopping_lists` only; the org's name
 *                 (`<list name> · <6 chars>`) never changes.
 *   Delete list — after a confirmation, `shopping.delete_list`: the list and its
 *                 items, then its org is hidden, then a full load back to "My
 *                 lists" (if that org was active, the session falls back to the
 *                 user's first org).
 *                 When the org is the user's last, or has other members, nothing
 *                 is deleted and the dialog says why.
 */
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n, type MessageKey } from "@/i18n";
import { runIntentAction } from "@/cortex/actions";
import { SHOPPING_LISTS_KEY, shoppingListKey } from "@/lib/query/useShoppingList";
import { SHOPPING_ROUTE } from "../nav";
import { LIST_NAME_MAX, type DeleteListResult, type List } from "../logic";
import {
  Dialog,
  FormActions,
  Modal,
  TextField,
  WriteErrorBanner,
  useMounted,
  type WriteErrorCode,
} from "./shared";

/** What the delete dialog says when the delete was refused. */
const REFUSAL_KEY: Record<Extract<DeleteListResult, { error: string }>["error"], MessageKey> = {
  lastOrg: "shopping.deleteRefusedLastOrg",
  otherMembers: "shopping.deleteRefusedOtherMembers",
  hideFailed: "shopping.deleteHideFailed",
};

export function RenameListModal({ list, onClose }: { list: List; onClose: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const mounted = useMounted();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(list.name);
  const [showRequired, setShowRequired] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [writeError, setWriteError] = useState<WriteErrorCode | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setShowRequired(true);
      return;
    }
    if (trimmed === list.name) {
      onClose();
      return;
    }
    setSubmitting(true);
    setWriteError(null);
    const res = await runIntentAction("shopping.rename_list", { id: list.id, name: trimmed });
    if (!mounted.current) return;
    setSubmitting(false);
    if (!res.ok) {
      setWriteError(res.code);
      return;
    }
    queryClient.setQueryData<List | null>(shoppingListKey(list.id), (prev) =>
      prev ? { ...prev, name: trimmed } : prev,
    );
    void queryClient.invalidateQueries({ queryKey: SHOPPING_LISTS_KEY });
    onClose();
  }

  return (
    <Modal title={t("shopping.renameList")} onClose={onClose} onSubmit={submit}>
      <WriteErrorBanner code={writeError} />
      <TextField
        label={t("shopping.listName")}
        value={name}
        onChange={(next) => {
          setName(next);
          if (next.trim()) setShowRequired(false);
        }}
        maxLength={LIST_NAME_MAX}
        required
        error={showRequired ? t("shopping.listNameRequired") : null}
        inputRef={inputRef}
      />
      <FormActions submitLabel={t("shopping.save")} onCancel={onClose} submitting={submitting} />
    </Modal>
  );
}

export function DeleteListDialog({ list, onClose }: { list: List; onClose: () => void }) {
  const { t } = useI18n();
  const mounted = useMounted();
  const [submitting, setSubmitting] = useState(false);
  const [writeError, setWriteError] = useState<WriteErrorCode | null>(null);
  const [refusal, setRefusal] = useState<MessageKey | null>(null);

  async function confirm() {
    if (submitting) return;
    setSubmitting(true);
    setWriteError(null);
    setRefusal(null);
    const res = await runIntentAction("shopping.delete_list", { id: list.id });
    if (!res.ok) {
      if (!mounted.current) return;
      setSubmitting(false);
      setWriteError(res.code);
      return;
    }
    const result = res.data as DeleteListResult;
    if ("error" in result) {
      if (!mounted.current) return;
      setSubmitting(false);
      setRefusal(REFUSAL_KEY[result.error]);
      return;
    }
    // FULL load back to "My lists": the list's org is now hidden, so if it was
    // the active org the session falls back to the user's first one, and no
    // cached row of the deleted list survives.
    window.location.assign(SHOPPING_ROUTE);
  }

  return (
    <Dialog title={t("shopping.deleteListTitle")} onClose={onClose}>
      <WriteErrorBanner code={writeError} />
      {refusal ? (
        <p role="alert" className="rounded-md bg-danger/10 px-sm py-xs type-label text-danger">
          {t(refusal)}
        </p>
      ) : (
        <p className="type-body text-muted">
          {t("shopping.deleteListBody").replace("{name}", list.name)}
        </p>
      )}
      <div className="flex gap-sm pt-xs">
        {refusal ? null : (
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={submitting}
            className="flex-1 rounded-md bg-danger py-sm type-label text-on-fill interactive motion-safe:active:scale-[0.97]"
          >
            {t("shopping.deleteListConfirm")}
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          className="flex-1 rounded-md bg-hairline py-sm type-label text-ink interactive motion-safe:active:scale-[0.97]"
        >
          {t(refusal ? "shopping.close" : "shopping.cancel")}
        </button>
      </div>
    </Dialog>
  );
}
