"use client";

/**
 * Orders full screen (Standard §2 `views/FullScreen.tsx`, §8) — the TRAFFIC
 * CONTROLLER. It reads the three shared caches once, works out where the user is
 * from the URL (`nav.ts`), and renders that one screen (`levels.tsx`):
 *
 *   categories → suppliers in a category → that supplier's products
 *   + suppliers management behind the hamburger
 *
 * The search text lives here, not in a level, so the floating bar can sit under
 * every screen; it is CLEARED whenever the location changes, because it filters
 * the current level only.
 *
 * Reads go through the server action (`runIntentAction`, session-built ctx); RLS
 * (org-tree membership AND `orders.access`) gates every row.
 */
import { useState } from "react";
import type { ToolViewProps } from "@/tools";
import { useI18n } from "@/i18n";
import { useSuppliersList } from "@/lib/query/useSuppliersList";
import { useCategoriesList, useProductsList } from "@/lib/query/useOrdersCatalog";
import { ordersHref, useOrdersNav } from "../nav";
import {
  CategoriesLevel,
  CategorySuppliersLevel,
  ProductsLevel,
  SuppliersManager,
  type CatalogData,
} from "./levels";
import { OrdersBar } from "./OrdersBar";
import { EmptyCard, SKELETON, ToolHeader } from "./shared";

// userId/orgId arrive as props but are NOT sent to the action — the server
// derives identity from the session cookie.
export function FullScreen(_props: ToolViewProps) {
  const { t } = useI18n();
  const { location, go } = useOrdersNav();
  const suppliersQ = useSuppliersList();
  const categoriesQ = useCategoriesList();
  const productsQ = useProductsList();
  // The search text is stored WITH the location it was typed on, so a new screen
  // starts unfiltered without an effect resetting it.
  const locationKey = ordersHref(location);
  const [searchState, setSearchState] = useState({ at: locationKey, text: "" });
  const search = searchState.at === locationKey ? searchState.text : "";
  const setSearch = (text: string) => setSearchState({ at: locationKey, text });

  const loading = suppliersQ.isLoading || categoriesQ.isLoading || productsQ.isLoading;
  const failed = suppliersQ.isError || categoriesQ.isError || productsQ.isError;

  const data: CatalogData = {
    suppliers: suppliersQ.suppliers,
    categories: categoriesQ.categories,
    products: productsQ.products,
  };
  const levelProps = { data, search, go };

  let screen;
  if (loading) {
    screen = (
      <>
        <ToolHeader title={t("orders.name")} />
        <ul className="flex flex-col divide-y divide-hairline" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-center justify-between py-sm">
              <span className={`h-5 w-32 ${SKELETON}`} />
              <span className={`h-4 w-16 ${SKELETON}`} />
            </li>
          ))}
        </ul>
      </>
    );
  } else if (failed) {
    screen = (
      <>
        <ToolHeader title={t("orders.name")} />
        <EmptyCard titleKey="orders.loadFailed" />
      </>
    );
  } else {
    switch (location.view) {
      case "categories":
        screen = <CategoriesLevel {...levelProps} />;
        break;
      case "category":
        screen = <CategorySuppliersLevel {...levelProps} categoryId={location.categoryId} />;
        break;
      case "products":
        screen = (
          <ProductsLevel
            {...levelProps}
            categoryId={location.categoryId}
            supplierId={location.supplierId}
          />
        );
        break;
      case "suppliers":
        screen = <SuppliersManager {...levelProps} />;
        break;
    }
  }

  return (
    <>
      {/* Keyed by location so per-screen state (open forms, armed deletes)
          resets when moving between levels. */}
      <div key={locationKey} className="contents">
        {screen}
      </div>
      <OrdersBar
        key={`bar${locationKey}`}
        search={search}
        onSearchChange={setSearch}
        onManageSuppliers={() => go({ view: "suppliers" })}
      />
    </>
  );
}
