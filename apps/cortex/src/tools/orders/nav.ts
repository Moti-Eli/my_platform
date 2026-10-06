"use client";

/**
 * Where the user is inside the orders tool — kept in the URL's query string so
 * the phone's back button walks back up the levels and a refresh stays put:
 *
 *   (none)                         → categories (the main screen)
 *   ?category=<id>                 → suppliers in that category
 *   ?category=<id>&supplier=<id>   → that supplier's products in that category
 *   ?view=suppliers                → suppliers management (behind the hamburger)
 *
 * Navigation uses `window.history.pushState`, which Next's App Router syncs into
 * `useSearchParams` WITHOUT a server round-trip — moving between levels is pure
 * client state over data that is already cached.
 */
import { useCallback } from "react";
import { useSearchParams } from "next/navigation";

/** The tool's route (matches `TOOL_VIEWS.orders.route`). */
export const ORDERS_ROUTE = "/tools/orders";

export type OrdersLocation =
  | { view: "categories" }
  | { view: "category"; categoryId: string }
  | { view: "products"; categoryId: string; supplierId: string }
  | { view: "suppliers" };

/** The query string for a location ('' for the main screen). */
export function ordersHref(loc: OrdersLocation): string {
  switch (loc.view) {
    case "categories":
      return "";
    case "category":
      return `?category=${encodeURIComponent(loc.categoryId)}`;
    case "products":
      return `?category=${encodeURIComponent(loc.categoryId)}&supplier=${encodeURIComponent(loc.supplierId)}`;
    case "suppliers":
      return "?view=suppliers";
  }
}

export function useOrdersNav() {
  const params = useSearchParams();

  const category = params.get("category");
  const supplier = params.get("supplier");
  const location: OrdersLocation =
    params.get("view") === "suppliers"
      ? { view: "suppliers" }
      : category && supplier
        ? { view: "products", categoryId: category, supplierId: supplier }
        : category
          ? { view: "category", categoryId: category }
          : { view: "categories" };

  const go = useCallback((loc: OrdersLocation) => {
    window.history.pushState(null, "", `${window.location.pathname}${ordersHref(loc)}`);
  }, []);

  return { location, go };
}
