"use client";

/**
 * "New list" modal — one field, the list name. "Create" runs
 * `shopping.create_list` (which creates the list's own org and installs the tool
 * there), then switches to that org and lands in the new list.
 *
 * The switch is the same as the org switcher's: set ORG_COOKIE, then a FULL
 * document load (never router.push) — the react-query cache is not org-scoped,
 * so a soft navigation would keep the previous org's rows on screen.
 */
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import { runIntentAction } from "@/cortex/actions";
import { ORG_COOKIE, setPreferenceCookie } from "@/lib/cookies";
import { LIST_NAME_MAX } from "../logic";
import { SHOPPING_ROUTE } from "../nav";
import {
  FormActions,
  Modal,
  TextField,
  WriteErrorBanner,
  useMounted,
  type WriteErrorCode,
} from "./shared";

export function NewListModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const mounted = useMounted();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
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
    setSubmitting(true);
    setWriteError(null);
    const res = await runIntentAction("shopping.create_list", { name: trimmed });
    if (!res.ok) {
      if (!mounted.current) return;
      setWriteError(res.code);
      setSubmitting(false);
      return;
    }
    const { orgId } = res.data as { listId: string; orgId: string };
    setPreferenceCookie(ORG_COOKIE, orgId);
    window.location.assign(SHOPPING_ROUTE);
  }

  return (
    <Modal title={t("shopping.newListTitle")} onClose={onClose} onSubmit={submit}>
      <WriteErrorBanner code={writeError} />
      <TextField
        label={t("shopping.listName")}
        value={name}
        onChange={(next) => {
          setName(next);
          if (next.trim()) setShowRequired(false);
        }}
        placeholder={t("shopping.listNamePlaceholder")}
        maxLength={LIST_NAME_MAX}
        required
        error={showRequired ? t("shopping.listNameRequired") : null}
        inputRef={inputRef}
      />
      <FormActions submitLabel={t("shopping.create")} onCancel={onClose} submitting={submitting} />
    </Modal>
  );
}
