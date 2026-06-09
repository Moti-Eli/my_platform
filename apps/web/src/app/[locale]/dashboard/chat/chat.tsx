"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export interface ChatMessage {
  id: string;
  senderId: string;
  content: string;
  createdAt: string;
}

export function Chat({
  orgId,
  currentUserId,
  locale,
  directory,
  initialMessages,
}: {
  orgId: string;
  currentUserId: string;
  locale: string;
  directory: Record<string, string>;
  initialMessages: ChatMessage[];
}) {
  const t = useTranslations("chat");
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(false);

  const supabaseRef = useRef<ReturnType<typeof createSupabaseBrowserClient> | null>(null);
  if (supabaseRef.current === null) supabaseRef.current = createSupabaseBrowserClient();
  const supabase = supabaseRef.current;

  const seenIds = useRef<Set<string>>(new Set(initialMessages.map((m) => m.id)));
  const scrollRef = useRef<HTMLDivElement>(null);

  const timeFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }),
    [locale]
  );

  const addMessage = useCallback((m: ChatMessage) => {
    if (seenIds.current.has(m.id)) return; // de-dupe (e.g. our own realtime echo)
    seenIds.current.add(m.id);
    setMessages((prev) => [...prev, m]);
  }, []);

  // Realtime: subscribe to INSERTs for this org. RLS on `messages` is the real
  // boundary — a tampered filter still can't deliver another org's rows (the
  // socket only ever carries messages this user may SELECT). Clean lifecycle:
  // subscribe on mount, remove the channel on unmount.
  useEffect(() => {
    let active = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
      // Ensure the socket authenticates as the current user (so RLS applies).
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      if (data.session) await supabase.realtime.setAuth(data.session.access_token);
      if (!active) return;

      channel = supabase
        .channel(`org-chat:${orgId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages", filter: `organization_id=eq.${orgId}` },
          (payload) => {
            const r = payload.new as {
              id: string;
              sender_id: string;
              content: string;
              created_at: string;
            };
            addMessage({ id: r.id, senderId: r.sender_id, content: r.content, createdAt: r.created_at });
          }
        )
        .subscribe();
    })();

    return () => {
      active = false;
      if (channel) supabase.removeChannel(channel);
    };
  }, [orgId, supabase, addMessage]);

  // Auto-scroll to the newest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setError(false);
    // Post through the AUTHENTICATED client: the `sender_id = auth.uid()` RLS
    // policy is the enforcer (a forged sender is impossible). The DB row is the
    // source of truth; we add it from the insert result (others get it live).
    const { data, error: insertError } = await supabase
      .from("messages")
      .insert({ organization_id: orgId, sender_id: currentUserId, content })
      .select("id, sender_id, content, created_at")
      .single();
    setSending(false);
    if (insertError || !data) {
      setError(true);
      return;
    }
    setDraft("");
    const row = data as { id: string; sender_id: string; content: string; created_at: string };
    addMessage({ id: row.id, senderId: row.sender_id, content: row.content, createdAt: row.created_at });
  };

  return (
    <div className="flex h-[60vh] min-h-[420px] flex-col overflow-hidden rounded-2xl border border-border bg-card">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-5 sm:px-5">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="size-6">
                <path
                  d="M7.5 8.5h9M7.5 12h6M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3 20.5l1.4-5.2A8.5 8.5 0 1 1 21 11.5Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          </div>
        ) : (
          messages.map((m) => {
            const isOwn = m.senderId === currentUserId;
            const name = isOwn ? t("you") : directory[m.senderId] ?? t("unknownSender");
            return (
              <div key={m.id} className={`flex ${isOwn ? "justify-end" : "justify-start"}`}>
                <div className={`flex max-w-[78%] flex-col gap-0.5 ${isOwn ? "items-end" : "items-start"}`}>
                  {!isOwn && (
                    <span className="px-1 text-xs font-medium text-muted-foreground">{name}</span>
                  )}
                  <div
                    className={`rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                      isOwn
                        ? "rounded-ee-md bg-primary text-primary-foreground"
                        : "rounded-es-md bg-muted text-foreground"
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words">{m.content}</p>
                  </div>
                  <time
                    dateTime={m.createdAt}
                    className="px-1 text-[10px] tabular-nums text-muted-foreground"
                  >
                    {timeFormatter.format(new Date(m.createdAt))}
                  </time>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Composer */}
      <form onSubmit={send} className="border-t border-border bg-card p-3">
        {error && (
          <p role="alert" className="mb-2 px-1 text-xs text-destructive">
            {t("sendError")}
          </p>
        )}
        <div className="flex items-end gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("placeholder")}
            aria-label={t("placeholder")}
            maxLength={2000}
            className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          />
          <button
            type="submit"
            disabled={sending || draft.trim().length === 0}
            aria-label={t("send")}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="size-4 rtl:-scale-x-100">
              <path d="M3.4 2.6a.75.75 0 0 0-.99.93l2.1 6.22h7.24a.75.75 0 0 1 0 1.5H4.51l-2.1 6.22a.75.75 0 0 0 .99.93c5.2-2.04 10.04-4.5 14.5-7.37a.75.75 0 0 0 0-1.28C13.44 7.1 8.6 4.64 3.4 2.6Z" />
            </svg>
            <span className="hidden sm:inline">{sending ? t("sending") : t("send")}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
