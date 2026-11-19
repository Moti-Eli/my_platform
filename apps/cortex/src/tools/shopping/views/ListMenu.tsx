"use client";

/**
 * The list's ☰ menu (header action) — the orders bar's menu chrome, opening
 * below the button. Two actions:
 *
 *   Rename list — the list's name in `shopping_lists` only; the org's name
 *                 (`<list name> · <6 chars>`) never changes.
 *   Delete list — after a confirmation, `shopping.delete_list`: the list and its
 *                 items, then its org is hidden, then a full load to "/" — the
 *                 session falls back to the user's first org (their main one).
 *                 When the org is the user's last, or has other members, nothing
 *                 is deleted and the dialog says why.
 */
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n, type MessageKey } from "@/i18n";
import { runIntentAction } from "@/cortex/actions";
import { MenuIcon } from "@/components/icons";
import { SHOPPING_LIST_KEY } from "@/lib/query/useShoppingList";
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

export function ListMenu({ list }: { list: List }) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={t("shopping.menu")}
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full interactive motion-safe:active:scale-[0.97] ${
          menuOpen ? "bg-app-amber/15 text-app-amber" : "bg-card text-ink"
        }`}
      >
        <MenuIcon width={18} height={18} />
      </button>
      {menuOpen ? (
        <>
          {/* Tap-anywhere-else closes the menu. Below the menu, above the page. */}
          <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setMenuOpen(false)} />
          <div
            role="menu"
            className="absolute end-0 top-full z-50 mt-xs flex min-w-max flex-col rounded-lg border border-hairline bg-card p-2xs shadow-lifted"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setRenaming(true);
              }}
              className="rounded-md px-sm py-xs text-start type-label text-ink interactive"
            >
              {t("shopping.renameList")}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setDeleting(true);
              }}
              className="rounded-md px-sm py-xs text-start type-label text-danger interactive"
            >
              {t("shopping.deleteList")}
            </button>
          </div>
        </>
      ) : null}

      {renaming ? <RenameListModal list={list} onClose={() => setRenaming(false)} /> : null}
      {deleting ? <DeleteListDialog list={list} onClose={() => setDeleting(false)} /> : null}
    </div>
  );
}

function RenameListModal({ list, onClose }: { list: List; onClose: () => void }) {
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
    queryClient.setQueryData<List | null>(SHOPPING_LIST_KEY, (prev) =>
      prev ? { ...prev, name: trimmed } : prev,
    );
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

function DeleteListDialog({ list, onClose }: { list: List; onClose: () => void }) {
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
    // FULL load (as the org switcher): the hidden org drops out of the session,
    // which falls back to the user's first org.
    window.location.assign("/");
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
