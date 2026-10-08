"use client";

/**
 * react-query hook for the shifts tool's positions. Same shape as the orders
 * hooks: the queryFn calls the SERVER action (session-built ctx on every call)
 * and turns a `!res.ok` into a thrown Error so `isError` is real.
 *
 * Every shifts view shares this cache entry and reconciles it via `setQueryData`
 * after its own writes. Returned sorted for display: by `position`, then name.
 */
import { useQuery } from "@tanstack/react-query";
import { runIntentAction } from "@/cortex/actions";
import type { Position } from "@/tools/shifts/logic";

export const SHIFT_POSITIONS_KEY = ["shifts", "positions"] as const;

export function sortPositions(list: readonly Position[], locale: string): Position[] {
  return [...list].sort(
    (a, b) =>
      a.position - b.position || a.name.localeCompare(b.name, locale, { sensitivity: "base" }),
  );
}

export function useShiftPositions() {
  const query = useQuery({
    queryKey: SHIFT_POSITIONS_KEY,
    queryFn: async (): Promise<Position[]> => {
      const res = await runIntentAction("shifts.list_positions", {});
      if (!res.ok) throw new Error(res.code);
      return res.data as Position[];
    },
  });
  const positions: Position[] = query.data ?? [];
  return { ...query, positions };
}
