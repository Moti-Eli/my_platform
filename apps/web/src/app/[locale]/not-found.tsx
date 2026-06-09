import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

/**
 * Localized, themed 404 page. Rendered inside the [locale] layout, so it has full
 * i18n context (he/en, RTL/LTR) and the active theme.
 */
export default async function NotFound() {
  const t = await getTranslations("notFound");

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden px-6">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute start-1/2 top-[36%] size-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-[130px] rtl:translate-x-1/2" />
      </div>

      <div className="flex max-w-md flex-col items-center text-center">
        <span
          aria-hidden="true"
          className="fade-rise select-none bg-gradient-to-b from-primary/80 to-primary/25 bg-clip-text text-[clamp(6.5rem,24vw,14rem)] font-black leading-none tracking-tighter text-transparent"
          style={{ animationDelay: "0ms" }}
        >
          404
        </span>

        <h1
          className="fade-rise mt-2 text-balance text-2xl font-bold tracking-tight text-foreground"
          style={{ animationDelay: "80ms" }}
        >
          {t("title")}
        </h1>
        <p
          className="fade-rise mt-2 max-w-sm text-pretty text-sm leading-relaxed text-muted-foreground"
          style={{ animationDelay: "150ms" }}
        >
          {t("description")}
        </p>

        <div className="fade-rise mt-7" style={{ animationDelay: "220ms" }}>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-[0.98]"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="size-4 rtl:rotate-180"
            >
              <path
                fillRule="evenodd"
                d="M12.79 5.23a.75.75 0 0 1 0 1.06L9.06 10l3.73 3.71a.75.75 0 1 1-1.06 1.06l-4.25-4.24a.75.75 0 0 1 0-1.06l4.25-4.24a.75.75 0 0 1 1.06 0Z"
                clipRule="evenodd"
              />
            </svg>
            {t("goHome")}
          </Link>
        </div>
      </div>
    </main>
  );
}
