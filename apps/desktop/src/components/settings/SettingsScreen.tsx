import { useTheme } from "next-themes";
import { SUPPORTED_LOCALES, useI18n } from "../../lib/i18n";
import type { Locale } from "../../lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { UpdatesCard } from "./UpdatesCard";

const LOCALE_LABELS: Record<Locale, string> = {
  el: "Ελληνικά",
  en: "English",
};

export function SettingsScreen() {
  const { t, locale, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();

  return (
    <section className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.theme")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={theme ?? "system"} onValueChange={setTheme}>
            <TabsList>
              <TabsTrigger value="light">{t("settings.themeLight")}</TabsTrigger>
              <TabsTrigger value="dark">{t("settings.themeDark")}</TabsTrigger>
              <TabsTrigger value="system">{t("settings.themeSystem")}</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.language")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Select value={locale} onValueChange={(value) => setLocale(value as Locale)}>
            <SelectTrigger className="w-full max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SUPPORTED_LOCALES.map((code) => (
                <SelectItem key={code} value={code}>
                  {LOCALE_LABELS[code]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">{t("settings.languageNote")}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.currency")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-sm font-medium">EUR (€)</p>
          <p className="text-sm text-muted-foreground">{t("settings.currencyNote")}</p>
        </CardContent>
      </Card>

      <UpdatesCard />
    </section>
  );
}
