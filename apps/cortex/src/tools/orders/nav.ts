"use client";

/**
 * Where the user is inside the orders tool — kept in the URL's query string so
 * the phone's back button walks back up the levels and a refresh stays put:
 *
 *   (none)                         → categories (the main screen)
 *   ?category=<id>                 → suppliers in that category
 *   ?category=<id>&supplier=<id>   → that supplier's products in that category
 *   ?view=suppliers[&edit=<id>]    → suppliers management (behind the hamburger),
 *                                    optionally with one supplier's editor open
 *   ?view=order&supplier=<id>[&category=<id>]
 *                                  → the order summary for that supplier
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
  /** The order summary for one supplier. `categoryId` = where "done" returns to. */
  | { view: "order"; supplierId: string; categoryId?: string }
  /** `editId` opens that supplier's editor straight away (e.g. "no phone" link). */
  | { view: "suppliers"; editId?: string };

/** The query string for a location ('' for the main screen). */
export function ordersHref(loc: OrdersLocation): string {
  const q = (v: string) => encodeURIComponent(v);
  switch (loc.view) {
    case "categories":
      return "";
    case "category":
      return `?category=${q(loc.categoryId)}`;
    case "products":
      return `?category=${q(loc.categoryId)}&supplier=${q(loc.supplierId)}`;
    case "order":
      return `?view=order&supplier=${q(loc.supplierId)}${loc.categoryId ? `&category=${q(loc.categoryId)}` : ""}`;
    case "suppliers":
      return `?view=suppliers${loc.editId ? `&edit=${q(loc.editId)}` : ""}`;
  }
}

export function useOrdersNav() {
  const params = useSearchParams();

  const view = params.get("view");
  const category = params.get("category");
  const supplier = params.get("supplier");
  const edit = params.get("edit");
  const location: OrdersLocation =
    view === "suppliers"
      ? { view: "suppliers", ...(edit ? { editId: edit } : {}) }
      : view === "order" && supplier
        ? { view: "order", supplierId: supplier, ...(category ? { categoryId: category } : {}) }
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
