import { setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { requireFeatureAccess } from "@/lib/feature-guard";
import { QuotesView } from "@/features/quotes";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function QuotesPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Access boundary: authenticated only (quotes has no permission/owner gate —
  // requiredPermission is null).
  await requireFeatureAccess("quotes", locale);

  return <QuotesView />;
}
