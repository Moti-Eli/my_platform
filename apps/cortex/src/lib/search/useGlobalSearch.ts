"use client";

/**
 * Global shell search — a live, cross-tool search that reads ONLY the react-query
 * CACHES the installed tools have already populated. It issues NO network request,
 * runs NO intent, and hits NO endpoint: the user warms each tool's cache by
 * visiting it, stale-while-revalidate keeps those caches fresh, and this hook just
 * greps what is loaded. That is the whole design — search is a view over cache.
 *
 * WHY POINT READS (getQueryData), NOT useQuery: subscribing would mount six live
 * queries off a transient overlay and could trigger fetches; instead each keystroke
 * re-reads the caches synchronously via `queryClient.getQueryData(KEY)`. A cache
 * that a tool hasn't been opened to fill simply contributes nothing — correct, not
 * a bug. (LATER: a search-open handler could pre-warm caches with
 * `queryClient.prefetchQuery` so first-time search is fuller; deliberately NOT built
 * here — this step searches what's already loaded.)
 *
 * STAFF IS ADMIN-GATED. The staff cache (STAFF_MEMBERS_KEY) can only ever exist for
 * an admin: the `/tools/staff` route redirects non-admins before its query can run,
 * and the catalog card is locked so a non-admin can't even install it. So its
 * presence is a sound client-side admin signal — but we still gate staff results on
 * an explicit `isAdmin` flag AND on the tool being installed AND on a non-empty
 * cache, so nothing about a member list can leak into a non-admin's search.
 */
import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { appRoute } from "@/cortex/apps";
import { INVENTORY_STOCK_KEY } from "@/lib/query/useInventoryStock";
import { TASKS_LIST_KEY } from "@/lib/query/useTasksList";
import { NOTES_LIST_KEY } from "@/lib/query/useNotesList";
import { EXPENSES_LIST_KEY } from "@/lib/query/useExpensesList";
import { JOURNAL_LIST_KEY } from "@/lib/query/useJournalList";
import { CANDIDATES_LIST_KEY } from "@/lib/query/useCandidatesList";
import { STAFF_MEMBERS_KEY } from "@/lib/query/useStaffMembers";
import type { InventoryItem } from "@/tools/inventory/logic";
import type { Task } from "@/tools/tasks/logic";
import type { Note } from "@/tools/notes/logic";
import type { Expense } from "@/tools/expenses/logic";
import type { Entry } from "@/tools/journal/logic";
import type { Candidate } from "@/tools/candidates/logic";
import type { Member } from "@/tools/staff/logic";

/** One matched row within a tool's group. `route` is the tool's full-screen route
 * (there are no per-item routes) — opening a result opens the tool. */
export interface SearchHit {
  id: string;
  primary: string;
  secondary: string | null;
  route: string;
}

/** Results for one tool: its id, the i18n key for its display name (reused from the
 * tool's manifest name — `<tool>.name`), the capped hits, and how many more matched
 * beyond the cap. */
export interface SearchGroup {
  tool: string;
  labelKey: string;
  items: SearchHit[];
  more: number;
}

/** At most this many rows per tool before collapsing the rest into a "+N more". */
const PER_GROUP_CAP = 5;

/** Build a group from a tool's matched hits, or null when nothing matched. */
function toGroup(tool: string, hits: SearchHit[]): SearchGroup | null {
  if (hits.length === 0) return null;
  return {
    tool,
    labelKey: `${tool}.name`,
    items: hits.slice(0, PER_GROUP_CAP),
    more: Math.max(0, hits.length - PER_GROUP_CAP),
  };
}

export interface GlobalSearchOptions {
  /** The ids of tools the user has installed — only these are searched. */
  installedIds: string[];
  /** Whether the current user is an admin (gates the staff group; see file header). */
  isAdmin: boolean;
}

/**
 * Search every installed tool's cached list by a case-insensitive substring over
 * that type's text fields, returning grouped, capped results. An empty query
 * returns NO groups (not everything) — search is intentional, not a full dump.
 */
export function useGlobalSearch(
  query: string,
  { installedIds, isAdmin }: GlobalSearchOptions,
): SearchGroup[] {
  const queryClient = useQueryClient();

  return useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return [];

    const has = (id: string) => installedIds.includes(id);
    const match = (value: string | null | undefined) =>
      typeof value === "string" && value.toLowerCase().includes(q);

    const groups: SearchGroup[] = [];

    // Fixed, sensible order; only installed tools with matches appear.
    if (has("inventory")) {
      const items = queryClient.getQueryData<InventoryItem[]>(INVENTORY_STOCK_KEY) ?? [];
      const hits = items
        .filter((it) => match(it.name))
        .map<SearchHit>((it) => ({
          id: it.id,
          primary: it.name,
          secondary: `${it.quantity} ${it.unit}`,
          route: appRoute("inventory"),
        }));
      const group = toGroup("inventory", hits);
      if (group) groups.push(group);
    }

    if (has("tasks")) {
      const items = queryClient.getQueryData<Task[]>(TASKS_LIST_KEY) ?? [];
      const hits = items
        .filter((it) => match(it.title))
        .map<SearchHit>((it) => ({
          id: it.id,
          primary: it.title,
          secondary: it.dueDate ? it.dueDate.slice(0, 10) : null,
          route: appRoute("tasks"),
        }));
      const group = toGroup("tasks", hits);
      if (group) groups.push(group);
    }

    if (has("notes")) {
      const items = queryClient.getQueryData<Note[]>(NOTES_LIST_KEY) ?? [];
      const hits = items
        .filter((it) => match(it.title) || match(it.body))
        .map<SearchHit>((it) => ({
          id: it.id,
          primary: it.title,
          secondary: it.body !== "" ? it.body : null,
          route: appRoute("notes"),
        }));
      const group = toGroup("notes", hits);
      if (group) groups.push(group);
    }

    if (has("expenses")) {
      const items = queryClient.getQueryData<Expense[]>(EXPENSES_LIST_KEY) ?? [];
      const hits = items
        .filter((it) => match(it.category) || match(it.note))
        .map<SearchHit>((it) => ({
          id: it.id,
          primary: it.category,
          secondary: it.note !== "" ? it.note : null,
          route: appRoute("expenses"),
        }));
      const group = toGroup("expenses", hits);
      if (group) groups.push(group);
    }

    if (has("journal")) {
      const items = queryClient.getQueryData<Entry[]>(JOURNAL_LIST_KEY) ?? [];
      const hits = items
        .filter((it) => match(it.content) || match(it.mood))
        .map<SearchHit>((it) => ({
          id: it.id,
          primary: it.content,
          secondary: it.mood ?? it.entryDate,
          route: appRoute("journal"),
        }));
      const group = toGroup("journal", hits);
      if (group) groups.push(group);
    }

    if (has("candidates")) {
      const items = queryClient.getQueryData<Candidate[]>(CANDIDATES_LIST_KEY) ?? [];
      const hits = items
        .filter(
          (it) =>
            match(it.name) ||
            match(it.role) ||
            match(it.city) ||
            match(it.phone) ||
            match(it.email) ||
            match(it.summary) ||
            match(it.impression) ||
            it.tags.some((tag) => match(tag)),
        )
        .map<SearchHit>((it) => {
          // Secondary: role when present, otherwise city, otherwise nothing.
          const base = it.role !== "" ? it.role : it.city !== "" ? it.city : null;
          // Archived candidates ARE included (a name search must find them
          // regardless of stage), but marked so a hit is not mistaken for an
          // active candidate. This hook has no t() — it returns i18n KEYS, never
          // resolved text — so the mark is the RAW stage, prefixed.
          const secondary =
            it.stage === "archived" ? (base ? `${it.stage} · ${base}` : it.stage) : base;
          return { id: it.id, primary: it.name, secondary, route: appRoute("candidates") };
        });
      const group = toGroup("candidates", hits);
      if (group) groups.push(group);
    }

    // Staff LAST and TRIPLE-GATED: admin flag + installed + a cache that only an
    // admin could have populated (see file header). A non-admin never reaches here.
    if (isAdmin && has("staff")) {
      const members = queryClient.getQueryData<Member[]>(STAFF_MEMBERS_KEY) ?? [];
      const hits = members
        .filter((m) => match(m.displayName) || match(m.email))
        .map<SearchHit>((m) => ({
          id: m.userId,
          primary: m.displayName ?? m.email,
          secondary: m.displayName ? m.email : null,
          route: appRoute("staff"),
        }));
      const group = toGroup("staff", hits);
      if (group) groups.push(group);
    }

    return groups;
  }, [query, installedIds, isAdmin, queryClient]);
}
