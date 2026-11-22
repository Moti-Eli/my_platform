"use client";

/**
 * The user's OWN list types (stage 2, decision 4A) — the small pieces the
 * screens share:
 *
 *   NewTypeModal      "New type": a name (unique per user, ignoring case) and
 *                     one of the accent colours (typeColors.ts).
 *   TypeChoices       a row of choices — "No type", each type, "＋ New type" —
 *                     used by the new-list form and the list's type dialog.
 *   ListTypeDialog    "List type" for one list: pick → saved at once.
 *   TypeDot           the type's colour as a small dot.
 *
 * Every write patches the shared types cache (SHOPPING_TYPES_KEY), so "My
 * lists", its filter and the Home card follow at once. None of this renders
 * while types are unavailable (tables not migrated) — the callers check
 * `available` first.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n, type MessageKey } from "@/i18n";
import { runIntentAction } from "@/cortex/actions";
import { CheckIcon, PlusIcon } from "@/components/icons";
import { SHOPPING_TYPES_KEY, useShoppingTypes } from "@/lib/query/useShoppingTypes";
import { TYPE_NAME_MAX, type ListType, type ListTypes } from "../logic";
import { TYPE_COLORS, typeColorClasses, type TypeColor } from "../typeColors";
import {
  Dialog,
  FormActions,
  Modal,
  TextField,
  WriteErrorBanner,
  useMounted,
  type WriteErrorCode,
} from "./shared";

/** The type's colour as a small dot (neutral for none / an unknown colour). */
export function TypeDot({ color, size = "h-3 w-3" }: { color: string | null; size?: string }) {
  return <span aria-hidden="true" className={`${size} shrink-0 rounded-full ${typeColorClasses(color).dot}`} />;
}

/** What a screen reader hears for each colour swatch. */
const COLOR_LABEL: Record<TypeColor, MessageKey> = {
  amber: "shopping.colorAmber",
  green: "shopping.colorGreen",
  coral: "shopping.colorCoral",
  violet: "shopping.colorViolet",
  blue: "shopping.colorBlue",
  teal: "shopping.colorTeal",
};

const sameName = (a: string, b: string) =>
  a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

/** "New type": name + colour. Hands the created type back. */
export function NewTypeModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (type: ListType) => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const mounted = useMounted();
  const { types } = useShoppingTypes();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  // Default: the first colour no type uses yet, so new types stand apart.
  const [color, setColor] = useState<TypeColor>(
    () => TYPE_COLORS.find((c) => !types.some((ty) => ty.color === c)) ?? TYPE_COLORS[0],
  );
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [writeError, setWriteError] = useState<WriteErrorCode | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // This modal can open from inside another form (New list) — keep the
    // submit from reaching it.
    e.stopPropagation();
    if (submitting) return;
    const trimmed = name.replace(/\s+/g, " ").trim();
    if (!trimmed) {
      setFieldError(t("shopping.typeNameRequired"));
      return;
    }
    if (types.some((ty) => sameName(ty.name, trimmed))) {
      setFieldError(t("shopping.typeNameExists"));
      return;
    }
    setSubmitting(true);
    setWriteError(null);
    const res = await runIntentAction("shopping.create_type", { name: trimmed, color });
    if (!mounted.current) return;
    setSubmitting(false);
    if (!res.ok) {
      setWriteError(res.code);
      return;
    }
    const created = res.data as ListType;
    queryClient.setQueryData<ListTypes>(SHOPPING_TYPES_KEY, (prev) =>
      prev ? { ...prev, types: [...prev.types, created] } : prev,
    );
    onCreated(created);
  }

  return (
    <Modal title={t("shopping.newTypeTitle")} onClose={onClose} onSubmit={submit}>
      <WriteErrorBanner code={writeError} />
      <TextField
        label={t("shopping.typeName")}
        value={name}
        onChange={(next) => {
          setName(next);
          setFieldError(null);
        }}
        placeholder={t("shopping.typeNamePlaceholder")}
        maxLength={TYPE_NAME_MAX}
        required
        error={fieldError}
        inputRef={inputRef}
      />
      <div className="flex flex-col gap-2xs">
        <span className="type-label text-muted">{t("shopping.typeColor")}</span>
        <div role="radiogroup" aria-label={t("shopping.typeColor")} className="flex flex-wrap gap-sm">
          {TYPE_COLORS.map((c) => {
            const active = c === color;
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={t(COLOR_LABEL[c])}
                onClick={() => setColor(c)}
                className={`flex h-9 w-9 items-center justify-center rounded-full interactive motion-safe:active:scale-[0.95] ${
                  typeColorClasses(c).filled
                } ${active ? "ring-2 ring-ink ring-offset-2 ring-offset-card" : ""}`}
              >
                {active ? <CheckIcon width={16} height={16} aria-hidden /> : null}
              </button>
            );
          })}
        </div>
      </div>
      <FormActions submitLabel={t("shopping.create")} onCancel={onClose} submitting={submitting} />
    </Modal>
  );
}

/**
 * A row of type choices: "No type", each of the user's types, "＋ New type".
 * `value` null = no type. Choosing "＋ New type" opens NewTypeModal, and the
 * new type is chosen at once.
 */
export function TypeChoices({
  value,
  onChange,
  disabled = false,
}: {
  value: string | null;
  onChange: (typeId: string | null) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const { types } = useShoppingTypes();
  const [creating, setCreating] = useState(false);

  const chip = (active: boolean, classes: string) =>
    `flex h-9 items-center gap-2xs rounded-pill px-sm type-label interactive motion-safe:active:scale-[0.97] ${
      active ? classes : "bg-screen text-ink"
    }`;

  return (
    <>
      <div role="radiogroup" aria-label={t("shopping.listType")} className="flex flex-wrap gap-xs">
        <button
          type="button"
          role="radio"
          aria-checked={value === null}
          disabled={disabled}
          onClick={() => onChange(null)}
          className={chip(value === null, typeColorClasses(null).filled)}
        >
          {t("shopping.noType")}
        </button>
        {types.map((ty) => (
          <button
            key={ty.id}
            type="button"
            role="radio"
            aria-checked={value === ty.id}
            disabled={disabled}
            onClick={() => onChange(ty.id)}
            className={chip(value === ty.id, typeColorClasses(ty.color).filled)}
          >
            {value === ty.id ? null : <TypeDot color={ty.color} size="h-2.5 w-2.5" />}
            {ty.name}
          </button>
        ))}
        <button
          type="button"
          disabled={disabled}
          onClick={() => setCreating(true)}
          className="flex h-9 items-center gap-2xs rounded-pill border border-dashed border-hairline px-sm type-label text-muted interactive"
        >
          <PlusIcon width={14} height={14} aria-hidden />
          {t("shopping.newType")}
        </button>
      </div>
      {/* PORTALLED, and walled off: this row can sit INSIDE another modal's
          <form> (New list). React events bubble along the component tree even
          through a portal, so without the wrapper a submit here would also
          submit the outer form, and a tap on this scrim would close it too. */}
      {creating && typeof document !== "undefined"
        ? createPortal(
            <div
              className="contents"
              onClick={(e) => e.stopPropagation()}
              onSubmit={(e) => e.stopPropagation()}
            >
              <NewTypeModal
                onClose={() => setCreating(false)}
                onCreated={(created) => {
                  setCreating(false);
                  onChange(created.id);
                }}
              />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/** Save "my type for this list" and patch the shared cache. */
export async function saveListType(
  queryClient: ReturnType<typeof useQueryClient>,
  listId: string,
  typeId: string | null,
): Promise<WriteErrorCode | null> {
  const res = await runIntentAction("shopping.set_list_type", { listId, typeId });
  if (!res.ok) return res.code;
  queryClient.setQueryData<ListTypes>(SHOPPING_TYPES_KEY, (prev) => {
    if (!prev) return prev;
    const links = { ...prev.links };
    if (typeId === null) delete links[listId];
    else links[listId] = typeId;
    return { ...prev, links };
  });
  return null;
}

/** "List type" for one list — choosing saves at once and closes. */
export function ListTypeDialog({ listId, onClose }: { listId: string; onClose: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const mounted = useMounted();
  const { typeOf } = useShoppingTypes();
  const [saving, setSaving] = useState(false);
  const [writeError, setWriteError] = useState<WriteErrorCode | null>(null);

  async function choose(typeId: string | null) {
    if (saving) return;
    if (typeId === (typeOf(listId)?.id ?? null)) {
      onClose();
      return;
    }
    setSaving(true);
    setWriteError(null);
    const code = await saveListType(queryClient, listId, typeId);
    if (!mounted.current) return;
    setSaving(false);
    if (code) setWriteError(code);
    else onClose();
  }

  return (
    <Dialog title={t("shopping.listType")} onClose={onClose}>
      <p className="type-caption text-muted">{t("shopping.listTypeHint")}</p>
      <WriteErrorBanner code={writeError} />
      <TypeChoices value={typeOf(listId)?.id ?? null} onChange={(id) => void choose(id)} disabled={saving} />
    </Dialog>
  );
}
