"use client";

/**
 * The AI drawer — a bottom sheet that opens ABOVE the tab bar (the tab bar is a
 * sibling of this overlay in AppShell and always stays on top + tappable). NO
 * real model yet: messages/history come from {@link useAiChat} (local, seeded
 * dummy data), the single seam a backend slots into later.
 *
 * Dismissal: tapping the AI tab again (toggle), tapping the grabber, dragging the
 * grabber/header down past a threshold (finger-following, snaps back if short),
 * or tapping the scrim. Drag/slide animations are gated behind `motion-safe`.
 *
 * Structure note: the sheet carries a `transform` (the drag), which would make a
 * `position:fixed` descendant clip to it — so the history row menu is portalled
 * to <body> (mirroring AppTabsRow's uninstall popover pattern, not a new one).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import {
  SearchIcon,
  ComposeIcon,
  MenuIcon,
  MicIcon,
  ArrowUpIcon,
  PlusIcon,
  CameraIcon,
  ImageIcon,
  PaperclipIcon,
  CopyIcon,
  ChevronDownIcon,
  CloseIcon,
} from "@/components/icons";
import { useI18n, getDirection, type MessageKey } from "@/i18n";
import { useAiChat, type AiChatStore } from "./useAiChat";

/** Drag distance (px) past which a release dismisses instead of snapping back. */
const DISMISS_PX = 100;
/** Movement (px) under which a grabber press counts as a tap (→ close), not a drag. */
const TAP_PX = 6;

const ICON_BTN =
  "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink touch-manipulation interactive motion-safe:active:scale-[0.97]";

export function AiSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const store = useAiChat();

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [plusOpen, setPlusOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [text, setText] = useState("");
  const [toast, setToast] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // ---- vertical drag-to-dismiss (grabber + header) --------------------------
  const startY = useRef<number | null>(null);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);

  const onDragStart = (e: ReactPointerEvent) => {
    startY.current = e.clientY;
    setDragging(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onDragMove = (e: ReactPointerEvent) => {
    if (startY.current === null) return;
    setDragY(Math.max(0, e.clientY - startY.current));
  };
  const endDrag = (tapCloses: boolean) => (e: ReactPointerEvent) => {
    const s = startY.current;
    startY.current = null;
    setDragging(false);
    setDragY(0);
    if (s === null) return;
    const dy = Math.max(0, e.clientY - s);
    if (dy > DISMISS_PX || (tapCloses && dy < TAP_PX)) onClose();
  };
  // Header drags too, but never from its buttons (so their taps still register).
  const onHeaderDown = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest("button, input")) return;
    onDragStart(e);
  };

  // Close on Escape while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const showCopied = useCallback(() => {
    setToast(true);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(false), 1200);
  }, []);

  const copy = useCallback(
    (value: string) => {
      navigator.clipboard?.writeText(value);
      showCopied();
    },
    [showCopied],
  );

  const resizeTextarea = () => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`; // ~5 lines, then scrolls
  };

  const newChat = () => {
    store.newConversation();
    setSearchOpen(false);
    setQuery("");
    setHistoryOpen(false);
  };

  const send = () => {
    // Presentational only — no model. Clears the composer (see file header).
    setText("");
    requestAnimationFrame(resizeTextarea);
  };

  const hasText = text.trim().length > 0;
  const needle = query.trim().toLowerCase();
  const messages = needle
    ? store.messages.filter((m) => m.text.toLowerCase().includes(needle))
    : store.messages;

  return (
    <div
      className={`absolute inset-0 z-40 ${open ? "" : "pointer-events-none"}`}
      role="dialog"
      aria-modal="true"
      aria-label={t("tabs.ai")}
    >
      {/* Scrim — dims the content area only (the tab bar is a sibling, never covered). */}
      <button
        type="button"
        aria-label={t("common.close")}
        onClick={onClose}
        className={`absolute inset-0 bg-scrim motion-safe:transition-opacity motion-safe:duration-300 ${
          open ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* Sheet */}
      <div
        className="absolute inset-x-0 bottom-0 flex max-h-full flex-col overflow-hidden rounded-t-xl bg-card shadow-lifted motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out"
        style={{
          height: "calc(var(--app-vh, 100dvh) * 0.66)",
          transform: open ? `translateY(${dragY}px)` : "translateY(110%)",
          transition: dragging ? "none" : undefined,
        }}
      >
        {/* Grabber — tap to close, or drag down to dismiss. */}
        <div
          className="flex shrink-0 cursor-grab touch-none justify-center pb-2xs pt-sm"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={endDrag(true)}
          onPointerCancel={endDrag(true)}
          aria-hidden
        >
          <span className="h-1.5 w-10 rounded-pill bg-hairline" />
        </div>

        {/* Header — also a drag handle (except its buttons). */}
        <div
          className="flex shrink-0 touch-none items-center justify-between px-xs pb-xs"
          onPointerDown={onHeaderDown}
          onPointerMove={onDragMove}
          onPointerUp={endDrag(false)}
          onPointerCancel={endDrag(false)}
        >
          {/* RTL start (right): search + new chat */}
          <div className="flex items-center">
            <button
              type="button"
              aria-label={t("ai.searchInChat")}
              onClick={() => setSearchOpen((v) => !v)}
              className={ICON_BTN}
            >
              <SearchIcon width={20} height={20} />
            </button>
            <button type="button" aria-label={t("ai.newChat")} onClick={newChat} className={ICON_BTN}>
              <ComposeIcon width={20} height={20} />
            </button>
          </div>

          {/* RTL end (left): history */}
          <button
            type="button"
            aria-label={t("ai.history")}
            onClick={() => setHistoryOpen(true)}
            className={ICON_BTN}
          >
            <MenuIcon width={20} height={20} />
          </button>
        </div>

        {/* Inline search-in-conversation */}
        {searchOpen ? (
          <div className="shrink-0 px-sm pb-xs">
            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("ai.searchPlaceholder")}
              className="h-10 w-full rounded-md bg-screen px-sm type-body text-ink outline-none placeholder:text-muted"
            />
          </div>
        ) : null}

        {/* Messages */}
        <div className="flex min-h-0 flex-1 flex-col gap-md overflow-y-auto px-md py-sm">
          {messages.map((m) =>
            m.role === "user" ? (
              <div
                key={m.id}
                className="max-w-[80%] self-start rounded-lg bg-screen px-md py-sm type-body text-ink"
              >
                {m.text}
              </div>
            ) : (
              <AiMessage
                key={m.id}
                text={m.text}
                onCopy={() => copy(m.text)}
                onDelete={() => store.deleteExchange(m.id)}
              />
            ),
          )}
          {messages.length === 0 ? (
            <p className="mt-2xl text-center type-label text-muted">{t("ai.notConnected")}</p>
          ) : null}
        </div>

        {/* Composer — pinned to the bottom of the sheet (messages take the rest),
            with only a small comfortable margin above the tab bar. */}
        <div className="relative shrink-0 px-sm pb-sm pt-2xs">
          <div className="flex items-end gap-2xs rounded-md bg-screen p-xs">
            {/* RTL start (right): mic ⇆ send */}
            {hasText ? (
              <button
                type="button"
                aria-label={t("common.send")}
                onClick={send}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-on-fill touch-manipulation interactive motion-safe:active:scale-[0.97]"
              >
                <ArrowUpIcon width={20} height={20} />
              </button>
            ) : (
              <button
                type="button"
                aria-label={t("ai.mic")}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink touch-manipulation interactive motion-safe:active:scale-[0.97]"
              >
                <MicIcon width={20} height={20} />
              </button>
            )}

            <textarea
              ref={taRef}
              rows={1}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                resizeTextarea();
              }}
              placeholder={t("ai.placeholder")}
              className="max-h-[7.5rem] flex-1 resize-none bg-transparent px-xs py-xs type-body text-ink outline-none placeholder:text-muted"
            />

            {/* RTL end (left): plus → attach menu */}
            <div className="relative">
              <button
                type="button"
                aria-label={t("ai.attach")}
                onClick={() => setPlusOpen((v) => !v)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink touch-manipulation interactive motion-safe:active:scale-[0.97]"
              >
                <PlusIcon width={20} height={20} />
              </button>

              {plusOpen ? (
                <div className="absolute bottom-full left-0 z-20 mb-xs flex min-w-44 flex-col rounded-lg bg-card p-xs shadow-lifted">
                  <AttachItem icon={<CameraIcon width={19} height={19} />} labelKey="ai.attachCamera" />
                  <AttachItem icon={<ImageIcon width={19} height={19} />} labelKey="ai.attachPhotos" />
                  <AttachItem icon={<PaperclipIcon width={19} height={19} />} labelKey="ai.attachFiles" />
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* Attach-menu outside-press catcher (sheet-wide, below the menu). */}
        {plusOpen ? (
          <button
            type="button"
            aria-label={t("common.close")}
            className="absolute inset-0 z-10"
            onClick={() => setPlusOpen(false)}
          />
        ) : null}

        <HistoryPanel open={historyOpen} onClose={() => setHistoryOpen(false)} store={store} />
      </div>

      {/* Copy toast — at the root (outside the transformed sheet). */}
      {toast ? (
        <div className="absolute bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-md bg-inverse px-sm py-xs type-caption text-inverse-ink shadow-lifted">
          {t("ai.copied")}
        </div>
      ) : null}
    </div>
  );
}

/** One attach option (presentational only — no file handling yet). */
function AttachItem({ icon, labelKey }: { icon: React.ReactNode; labelKey: MessageKey }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className="flex w-full items-center gap-sm rounded-md px-xs py-xs text-start type-label text-ink touch-manipulation interactive"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-screen text-ink">
        {icon}
      </span>
      {t(labelKey)}
    </button>
  );
}

/**
 * A full-width AI message: collapsed to ~5 lines with a soft fade; tapping the
 * body expands it (the chevron is the ONLY way to collapse). Below: chevron,
 * copy, delete (delete removes the pair via the store).
 */
function AiMessage({
  text,
  onCopy,
  onDelete,
}: {
  text: string;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);

  const actionBtn =
    "flex h-8 w-8 items-center justify-center rounded-md touch-manipulation interactive motion-safe:active:scale-[0.97]";

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => {
          if (!expanded) setExpanded(true);
        }}
        className={`relative block w-full text-start type-body text-ink interactive ${
          expanded ? "" : "max-h-[7.5rem] overflow-hidden"
        }`}
      >
        {text}
        {!expanded ? (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-b from-transparent to-card"
          />
        ) : null}
      </button>

      <div className="mt-2xs flex items-center gap-2xs text-muted">
        <button
          type="button"
          aria-label={expanded ? t("ai.collapse") : t("ai.expand")}
          onClick={() => setExpanded((v) => !v)}
          className={actionBtn}
        >
          <ChevronDownIcon
            width={16}
            height={16}
            className={`motion-safe:transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </button>
        <button type="button" aria-label={t("ai.copy")} onClick={onCopy} className={actionBtn}>
          <CopyIcon width={16} height={16} />
        </button>
        <button
          type="button"
          aria-label={t("ai.deleteMessage")}
          onClick={onDelete}
          className={`${actionBtn} text-danger`}
        >
          <CloseIcon width={16} height={16} />
        </button>
      </div>
    </div>
  );
}

interface RowMenu {
  id: string;
  title: string;
  top: number;
  left: number;
}

/**
 * Conversation history — slides in from the inline-END edge (left in RTL, right
 * in LTR), 60% wide. Swipe it sideways (finger-following, snaps back if short) or
 * tap outside to close. Each
 * row opens an anchored rename/delete popover — the SAME pattern as AppTabsRow's
 * uninstall menu (portalled to <body> because the sheet is transformed).
 */
function HistoryPanel({
  open,
  onClose,
  store,
}: {
  open: boolean;
  onClose: () => void;
  store: AiChatStore;
}) {
  const { t, locale } = useI18n();
  const rtl = getDirection(locale) === "rtl";
  const [menu, setMenu] = useState<RowMenu | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");

  // ---- horizontal swipe-to-close: OUTWARD toward the inline-end edge the panel
  // hangs off (leftward in RTL, rightward in LTR).
  const start = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<null | "h" | "v">(null);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: ReactPointerEvent) => {
    start.current = { x: e.clientX, y: e.clientY };
    axis.current = null;
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    if (!start.current) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    if (axis.current === null) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      axis.current = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
      if (axis.current === "h") {
        setDragging(true);
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }
    }
    // Follow the finger only OUTWARD (toward the end edge): left in RTL, right in LTR.
    if (axis.current === "h") setDragX(rtl ? Math.min(0, dx) : Math.max(0, dx));
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    const wasH = axis.current === "h";
    const raw = start.current ? e.clientX - start.current.x : 0;
    const outward = rtl ? Math.min(0, raw) : Math.max(0, raw);
    start.current = null;
    axis.current = null;
    setDragging(false);
    setDragX(0);
    if (wasH && Math.abs(outward) > DISMISS_PX) onClose();
  };

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menu]);

  const openRowMenu = (id: string, title: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setMenu({ id, title, top: r.bottom + 6, left: r.left + 12 });
  };

  const commitRename = () => {
    if (renamingId) store.renameConversation(renamingId, renameText);
    setRenamingId(null);
  };

  return (
    <>
      {/* Outside-press catcher (the exposed 40%). */}
      {open ? (
        <button
          type="button"
          aria-label={t("common.close")}
          onClick={onClose}
          className="absolute inset-0 z-20"
        />
      ) : null}

      <aside
        aria-label={t("ai.history")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={`absolute inset-y-0 end-0 z-30 flex w-[60%] touch-pan-y flex-col rounded-s-xl bg-card shadow-lifted motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out ${
          open ? "" : "pointer-events-none"
        }`}
        style={{
          // Hidden off the inline-end edge: left (-100%) in RTL, right (+100%) in LTR.
          transform: open ? `translateX(${dragX}px)` : `translateX(${rtl ? "-100%" : "100%"})`,
          transition: dragging ? "none" : undefined,
        }}
      >
        <h3 className="shrink-0 px-md pb-xs pt-md type-heading text-ink">{t("ai.history")}</h3>
        <ul className="min-h-0 flex-1 overflow-y-auto px-xs pb-sm">
          {store.conversations.map((c) => (
            <li key={c.id}>
              {renamingId === c.id ? (
                // eslint-disable-next-line jsx-a11y/no-autofocus
                <input
                  autoFocus
                  value={renameText}
                  onChange={(e) => setRenameText(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                  className="w-full rounded-md bg-screen px-sm py-xs type-heading text-ink outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={(e) => openRowMenu(c.id, c.title, e.currentTarget)}
                  className="flex w-full items-center rounded-lg px-sm py-sm text-start type-heading text-ink touch-manipulation interactive"
                >
                  <span className="truncate">{c.title}</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      </aside>

      {/* Anchored rename/delete popover — portalled out of the transformed sheet. */}
      {menu && typeof document !== "undefined"
        ? createPortal(
            <>
              <button
                type="button"
                aria-label={t("common.close")}
                onClick={() => setMenu(null)}
                className="fixed inset-0 z-[60]"
              />
              <div
                role="menu"
                aria-label={menu.title}
                className="ds-panel fixed z-[70] flex flex-col rounded-lg bg-card p-2xs shadow-lifted"
                style={{ top: menu.top, left: menu.left }}
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setRenameText(menu.title);
                    setRenamingId(menu.id);
                    setMenu(null);
                  }}
                  className="whitespace-nowrap rounded-md px-sm py-xs text-start type-label text-ink touch-manipulation interactive"
                >
                  {t("ai.rename")}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    store.deleteConversation(menu.id);
                    setMenu(null);
                  }}
                  className="whitespace-nowrap rounded-md px-sm py-xs text-start type-label text-danger touch-manipulation interactive"
                >
                  {t("ai.delete")}
                </button>
              </div>
            </>,
            document.body,
          )
        : null}
    </>
  );
}
