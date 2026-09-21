import { useState } from "react";
import { toast } from "sonner";
import { readCustomTheme, resetCustomTheme, setCustomThemeRole } from "../../lib/customTheme";
import type { CustomThemeColors, CustomThemeRole } from "../../lib/customTheme";
import { useI18n } from "../../lib/i18n";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Label } from "../ui/label";

/** Shown in each color input when no override is saved yet — a neutral starting point to pick
 * from, not a claim that it matches the active theme's actual (often OKLCH) color exactly. */
const FALLBACK_SWATCH: Record<CustomThemeRole, string> = {
  background: "#ffffff",
  text: "#171717",
  labels: "#737373",
};

const ROLES: CustomThemeRole[] = ["background", "text", "labels"];

const ROLE_LABEL_KEYS = {
  background: "settings.themeEditorBackground",
  text: "settings.themeEditorText",
  labels: "settings.themeEditorLabels",
} as const;

/**
 * Settings → Color Customization. Lets the user override the app's background/text/label colors
 * directly, independent of (and layered on top of) the light/dark/system theme above — see
 * lib/customTheme.ts for how a single role maps onto several shadcn CSS variables at once, and
 * why inline styles (not a stylesheet) are used so the override survives a light/dark switch.
 */
export function ThemeEditorCard() {
  const { t } = useI18n();
  const [colors, setColors] = useState<CustomThemeColors>(() => readCustomTheme());

  function handleChange(role: CustomThemeRole, value: string) {
    setColors(setCustomThemeRole(role, value));
  }

  function handleReset() {
    resetCustomTheme();
    setColors({});
    toast.success(t("settings.themeEditorResetSuccess"));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.themeEditor")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{t("settings.themeEditorHint")}</p>

        <div className="flex flex-wrap gap-6">
          {ROLES.map((role) => (
            <div key={role} className="flex flex-col gap-1.5">
              <Label htmlFor={`theme-color-${role}`}>{t(ROLE_LABEL_KEYS[role])}</Label>
              <input
                id={`theme-color-${role}`}
                type="color"
                value={colors[role] ?? FALLBACK_SWATCH[role]}
                onChange={(e) => handleChange(role, e.target.value)}
                className="h-10 w-16 cursor-pointer rounded-md border border-input p-1"
              />
            </div>
          ))}
        </div>

        <div>
          <Button type="button" variant="outline" onClick={handleReset}>
            {t("settings.themeEditorReset")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
