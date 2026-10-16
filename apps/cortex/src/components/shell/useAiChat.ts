"use client";

/**
 * Local, in-memory chat store for the AI drawer — the SINGLE seam a real backend
 * slots into. The UI ({@link AiSheet}) depends ONLY on the {@link AiChatStore}
 * shape, so swapping this hook's body for `runIntent`/Supabase calls later needs
 * NO change to the screen. Seeded with dummy exchanges + conversations so the
 * drawer can be judged before the model is connected (there is no real AI yet).
 */
import { useCallback, useState } from "react";

export type ChatRole = "user" | "ai";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
}

export interface Conversation {
  id: string;
  title: string;
}

/** The surface the screen consumes. A backend impl returns the same shape. */
export interface AiChatStore {
  messages: ChatMessage[];
  conversations: Conversation[];
  /** Delete an AI message together with the user message that prompted it (the pair). */
  deleteExchange: (aiMessageId: string) => void;
  /** Start a fresh conversation (clears the current transcript). */
  newConversation: () => void;
  renameConversation: (id: string, title: string) => void;
  deleteConversation: (id: string) => void;
}

// DEV dummy data — replaced by real messages/history when the backend lands.
const SEED_MESSAGES: ChatMessage[] = [
  { id: "m1", role: "user", text: "כמה עגבניות נשארו לי במלאי?" },
  {
    id: "m2",
    role: "ai",
    text:
      'נשארו לך 3 ק"ג עגבניות — מתחת לסף שהגדרת (10 ק"ג). בסך הכול יש כרגע 6 מוצרים מתחת ' +
      "לסף המלאי: עגבניות, פלפל אדום, אבטיח, ענבים, ביצים ובשר טחון. אם תרצה, אני יכול " +
      "להכין טיוטת הזמנה לספק עבור כל הפריטים החסרים, או להוסיף את כולם לרשימת הקניות שלך " +
      "כדי שתחליט מה להזמין. אני ממליץ להשלים את העגבניות ל‑10–12 ק\"ג לפי קצב המכירה של " +
      "השבוע האחרון, שהיה גבוה מהרגיל.",
  },
  { id: "m3", role: "user", text: "תוסיף את כולם לרשימת הקניות" },
  {
    id: "m4",
    role: "ai",
    text: 'הוספתי את כל 6 הפריטים החסרים לרשימת הקניות. אפשר לפתוח אותה מהכלי "קניות", או שאשלח לך סיכום עכשיו.',
  },
];

const SEED_CONVERSATIONS: Conversation[] = [
  { id: "c1", title: "מלאי — מוצרים חסרים" },
  { id: "c2", title: "סיכום משימות השבוע" },
  { id: "c3", title: "הזמנה מספק" },
  { id: "c4", title: "תכנון תקציב חודשי" },
  { id: "c5", title: "רשימת קניות לשבת" },
];

export function useAiChat(): AiChatStore {
  const [messages, setMessages] = useState<ChatMessage[]>(SEED_MESSAGES);
  const [conversations, setConversations] = useState<Conversation[]>(SEED_CONVERSATIONS);

  const deleteExchange = useCallback((aiMessageId: string) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === aiMessageId);
      if (idx === -1) return prev;
      // Remove the AI message and the user message immediately before it (the pair).
      const from = idx > 0 && prev[idx - 1]?.role === "user" ? idx - 1 : idx;
      return [...prev.slice(0, from), ...prev.slice(idx + 1)];
    });
  }, []);

  const newConversation = useCallback(() => setMessages([]), []);

  const renameConversation = useCallback((id: string, title: string) => {
    const next = title.trim();
    if (!next) return;
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title: next } : c)));
  }, []);

  const deleteConversation = useCallback((id: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== id));
  }, []);

  return {
    messages,
    conversations,
    deleteExchange,
    newConversation,
    renameConversation,
    deleteConversation,
  };
}
