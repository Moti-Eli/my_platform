import { getTranslations } from "next-intl/server";

export async function QuotesView() {
  const t = await getTranslations("quotes");

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <h1 className="text-balance text-2xl font-bold text-foreground">{t("title")}</h1>
    </main>
  );
}
