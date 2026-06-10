import { ComingSoon } from "@/components/coming-soon";
import { useI18n } from "@/lib/locale-context";

export default function PlatformScreen() {
  const { t } = useI18n();
  return <ComingSoon title={t("dashboard", "platformAdmin")} />;
}
