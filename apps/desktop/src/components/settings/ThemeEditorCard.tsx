import { X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  clearCustomThemeRole,
  readCustomTheme,
  resetCustomTheme,
  setCustomThemeRole,
} from "../../lib/customTheme";
import type { CustomThemeColors, CustomThemeRole } from "../../lib/customTheme";
import { useI18n } from "../../lib/i18n";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Label } from "../ui/label";

/** Shown in each color input when no override is saved yet — a neutral starting point to pick
 * from, not a claim that it matches the active theme's actual (often OKLCH) color exactly. */
const FALLBACK_SWATCH: Record<CustomThemeRole, string> = {
  primary: "#b45309",
  background: "#ffffff",
  text: "#171717",
  labels: "#737373",
};

const ROLES: CustomThemeRole[] = ["primary", "background", "text", "labels"];

const ROLE_LABEL_KEYS = {
  primary: "settings.themeEditorPrimary",
  background: "settings.themeEditorBackground",
  text: "settings.themeEditorText",
  labels: "settings.themeEditorLabels",
} as const;

/** A curated, bakery-appropriate starting palette for the brand/primary color — click one for an
 * instant result, or use the color picker next to it for full freedom. Purely a convenience; any
 * hex color works via the picker regardless of this list. */
const PRIMARY_PRESETS = [
  "#b45309", // terracotta
  "#65714f", // sage
  "#9f5a68", // dusty rose
  "#c99a2e", // honey
  "#5b4a8a", // plum
  "#2f5d73", // teal navy
];

/**
 * Settings → Color Customization. Lets the user override the app's brand/primary, background,
 * text, and label colors directly, independent of (and layered on top of) the light/dark/system
 * theme above — see lib/customTheme.ts for how a single role maps onto several shadcn CSS
 * variables at once, and why inline styles (not a stylesheet) are used so the override survives a
 * light/dark switch. Includes a live preview strip (real Button/Badge/Card components, so it
 * reflects the exact same variables the rest of the app uses) and per-role reset.
 */
export function ThemeEditorCard() {
  const { t } = useI18n();
  const [colors, setColors] = useState<CustomThemeColors>(() => readCustomTheme());

  function handleChange(role: CustomThemeRole, value: string) {
    setColors(setCustomThemeRole(role, value));
  }

  function handleClearRole(role: CustomThemeRole) {
    setColors(clearCustomThemeRole(role));
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
      <CardContent className="flex flex-col gap-5">
        <p className="text-sm text-muted-foreground">{t("settings.themeEditorHint")}</p>

        <div className="flex flex-wrap gap-6">
          {ROLES.map((role) => (
            <div key={role} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <Label htmlFor={`theme-color-${role}`}>{t(ROLE_LABEL_KEYS[role])}</Label>
                {colors[role] && (
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    title={t("settings.themeEditorClearRole")}
                    onClick={() => handleClearRole(role)}
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
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

        <div className="flex flex-col gap-1.5">
          <Label>{t("settings.themeEditorPrimaryPresets")}</Label>
          <div className="flex flex-wrap gap-2">
            {PRIMARY_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                title={preset}
                onClick={() => handleChange("primary", preset)}
                className="size-7 rounded-full border-2 border-transparent shadow-sm ring-1 ring-border transition-transform hover:scale-110 focus-visible:border-foreground"
                style={{ backgroundColor: preset }}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>{t("settings.themeEditorPreview")}</Label>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-background p-4">
            <Button type="button">{t("common.save")}</Button>
            <Button type="button" variant="outline">
              {t("common.cancel")}
            </Button>
            <Badge variant="success">{t("common.active")}</Badge>
            <Badge variant="destructive">{t("common.archived")}</Badge>
            <Badge variant="secondary">{t("common.category")}</Badge>
            <span className="text-sm text-foreground">{t("settings.themeEditorPreviewText")}</span>
            <span className="text-sm text-muted-foreground">
              {t("settings.themeEditorPreviewLabel")}
            </span>
          </div>
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
