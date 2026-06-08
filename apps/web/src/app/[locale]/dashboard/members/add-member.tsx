"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { addMemberAction, type AddMemberState } from "./actions";

const initialState: AddMemberState = { error: null, success: false };

type Role = "admin" | "member";

export function AddMember({ orgId, locale }: { orgId: string; locale: string }) {
  const t = useTranslations("members");
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(addMemberAction, initialState);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descId = useId();

  // Close (and reset) once a member was successfully created.
  useEffect(() => {
    if (state.success) setOpen(false);
  }, [state.success]);

  // When the modal opens: focus the first field and lock background scroll.
  useEffect(() => {
    if (!open) return;
    firstFieldRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-[0.98]"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="size-4">
          <path d="M10 5a.75.75 0 0 1 .75.75v3.5h3.5a.75.75 0 0 1 0 1.5h-3.5v3.5a.75.75 0 0 1-1.5 0v-3.5h-3.5a.75.75 0 0 1 0-1.5h3.5v-3.5A.75.75 0 0 1 10 5Z" />
        </svg>
        {t("addUser")}
      </button>

      {open && (
        <div
          className="modal-backdrop fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-4 backdrop-blur-sm sm:items-center"
          onMouseDown={(event) => {
            // Close only when the backdrop itself (not the dialog) is clicked.
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descId}
            className="modal-panel w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
              <div>
                <h2 id={titleId} className="text-lg font-bold text-foreground">
                  {t("addUser")}
                </h2>
                <p id={descId} className="mt-0.5 text-sm text-muted-foreground">
                  {t("addUserSubtitle")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("cancel")}
                className="-me-1.5 -mt-1.5 grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="size-4">
                  <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                </svg>
              </button>
            </div>

            <form action={formAction} className="px-6 py-5">
              <input type="hidden" name="orgId" value={orgId} />
              <input type="hidden" name="locale" value={locale} />

              <div className="space-y-4">
                <Field label={t("fieldEmail")} htmlForId="add-email">
                  <input
                    ref={firstFieldRef}
                    id="add-email"
                    name="email"
                    type="email"
                    required
                    autoComplete="off"
                    dir="ltr"
                    placeholder={t("fieldEmailPlaceholder")}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  />
                </Field>

                <Field label={t("fieldName")} htmlForId="add-name">
                  <input
                    id="add-name"
                    name="displayName"
                    type="text"
                    required
                    autoComplete="off"
                    placeholder={t("fieldNamePlaceholder")}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  />
                </Field>

                <Field label={t("fieldRole")} htmlForId="add-role">
                  <div className="relative">
                    <select
                      id="add-role"
                      name="targetRole"
                      defaultValue={"member" satisfies Role}
                      className="w-full appearance-none rounded-lg border border-border bg-background py-2 pe-9 ps-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      <option value="member">{t("roleMember")}</option>
                      <option value="admin">{t("roleAdmin")}</option>
                    </select>
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                    >
                      <path
                        fillRule="evenodd"
                        d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                </Field>
              </div>

              {/* The known dev password only applies outside production (see
                  newUserPassword() in actions.ts), so only hint at it there. */}
              {process.env.NODE_ENV !== "production" && (
                <p className="mt-4 flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground">
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="mt-px size-3.5 shrink-0"
                  >
                    <path
                      fillRule="evenodd"
                      d="M18 10A8 8 0 1 1 2 10a8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a.75.75 0 0 0 0 1.5h.253a.25.25 0 0 1 .244.304l-.459 2.066A1.75 1.75 0 0 0 10.747 15H11a.75.75 0 0 0 0-1.5h-.253a.25.25 0 0 1-.244-.304l.459-2.066A1.75 1.75 0 0 0 9.253 9H9Z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span>{t("tempPasswordNotice")}</span>
                </p>
              )}

              {state.error ? (
                <p
                  role="alert"
                  className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  {t(state.error)}
                </p>
              ) : null}

              <div className="mt-6 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  {t("cancel")}
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pending && (
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 20 20"
                      fill="none"
                      className="size-4 animate-spin"
                    >
                      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="2.5" className="opacity-25" />
                      <path d="M17 10a7 7 0 0 0-7-7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                    </svg>
                  )}
                  {pending ? t("adding") : t("addUserSubmit")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function Field({
  label,
  htmlForId,
  children,
}: {
  label: string;
  htmlForId: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlForId} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}
