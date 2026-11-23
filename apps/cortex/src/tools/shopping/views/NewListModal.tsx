"use client";

/**
 * "New list" modal — the list name, and (while types are available) one of
 * the user's own types, optional. "Create" runs `shopping.create_list` (which
 * creates the list's own org and installs the tool there), then — if a type
 * was chosen — `shopping.set_list_type`, refreshes "My lists" and hands the new
 * id back, so the screen opens the list IN PLACE (no org switch, no reload).
 * A failed type save does not block: the list exists and opens; its type can
 * be set from the list's ☰ menu.
 */
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { runIntentAction } from "@/cortex/actions";
import { SHOPPING_LISTS_KEY } from "@/lib/query/useShoppingList";
import { useShoppingTypes } from "@/lib/query/useShoppingTypes";
import { LIST_NAME_MAX } from "../logic";
import { TypeChoices, saveListType } from "./TypeViews";
import {
  FormActions,
  Modal,
  TextField,
  WriteErrorBanner,
  useMounted,
  type WriteErrorCode,
} from "./shared";

export function NewListModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  /** The new list's id — the caller opens it. */
  onCreated: (listId: string) => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const mounted = useMounted();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [showRequired, setShowRequired] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [writeError, setWriteError] = useState<WriteErrorCode | null>(null);
  const typesAvailable = useShoppingTypes().available;
  const [typeId, setTypeId] = useState<string | null>(null);

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
    const { listId } = res.data as { listId: string; orgId: string };
    if (typesAvailable && typeId !== null) await saveListType(queryClient, listId, typeId);
    await queryClient.invalidateQueries({ queryKey: SHOPPING_LISTS_KEY });
    if (!mounted.current) return;
    onCreated(listId);
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
      {typesAvailable ? (
        <div className="flex flex-col gap-2xs">
          <span className="type-label text-muted">{t("shopping.listTypeOptional")}</span>
          <TypeChoices value={typeId} onChange={setTypeId} disabled={submitting} />
        </div>
      ) : null}
      <FormActions submitLabel={t("shopping.create")} onCancel={onClose} submitting={submitting} />
    </Modal>
  );
}
