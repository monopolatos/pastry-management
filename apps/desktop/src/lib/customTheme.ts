/**
 * User-picked color overrides for the app's three broad visual roles (background, body text,
 * label/secondary text) — separate from and layered on top of the light/dark/system theme
 * (`next-themes`, see main.tsx). Applied as inline styles on `<html>`, which beats both `:root`
 * and `.dark` class selector rules in CSS specificity, so a custom color sticks regardless of
 * which light/dark theme is active; "Reset to defaults" just removes the inline overrides and
 * lets the underlying theme's own values show through again.
 *
 * Each role maps to several of shadcn's CSS variables at once (see CUSTOM_THEME_VAR_MAP) —
 * picking one "Background" color needs to repaint `--background`, `--card`, `--popover`, and
 * `--sidebar` together, since nearly all visible content sits inside a Card/Popover/Sidebar, each
 * with its own surface-color variable. Applying only `--background` would leave most of the app
 * looking unchanged.
 */

export type CustomThemeRole = "background" | "text" | "labels";

export type CustomThemeColors = Partial<Record<CustomThemeRole, string>>;

const STORAGE_KEY = "pastry-management.customTheme";

const CUSTOM_THEME_VAR_MAP: Record<CustomThemeRole, string[]> = {
  background: ["--background", "--card", "--popover", "--sidebar"],
  text: ["--foreground", "--card-foreground", "--popover-foreground", "--sidebar-foreground"],
  labels: ["--muted-foreground"],
};

export function readCustomTheme(): CustomThemeColors {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return {};
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== "object" || parsed === null) return {};
    const result: CustomThemeColors = {};
    for (const role of Object.keys(CUSTOM_THEME_VAR_MAP) as CustomThemeRole[]) {
      const value = (parsed as Record<string, unknown>)[role];
      if (typeof value === "string" && value !== "") result[role] = value;
    }
    return result;
  } catch {
    return {};
  }
}

/** Applies the given colors as inline CSS variable overrides on `<html>`. A role missing from
 * `colors` is left untouched — pass `{}` to apply nothing, or use `clearCustomThemeRole` to
 * remove a single role's override. */
export function applyCustomTheme(colors: CustomThemeColors): void {
  const root = document.documentElement;
  for (const [role, vars] of Object.entries(CUSTOM_THEME_VAR_MAP) as [
    CustomThemeRole,
    string[],
  ][]) {
    const value = colors[role];
    if (!value) continue;
    for (const cssVar of vars) {
      root.style.setProperty(cssVar, value);
    }
  }
}

function persist(colors: CustomThemeColors): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(colors));
  } catch {
    // Best-effort persistence only — the live preview above still applies within this session.
  }
}

/** Sets one role's color, applies it immediately, and persists the full set. */
export function setCustomThemeRole(role: CustomThemeRole, value: string): CustomThemeColors {
  const current = readCustomTheme();
  const next = { ...current, [role]: value };
  applyCustomTheme({ [role]: value });
  persist(next);
  return next;
}

/** Removes every override, both the inline styles and the persisted record. */
export function resetCustomTheme(): void {
  const root = document.documentElement;
  for (const vars of Object.values(CUSTOM_THEME_VAR_MAP)) {
    for (const cssVar of vars) {
      root.style.removeProperty(cssVar);
    }
  }
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing further to do — the inline styles are already gone, which is what matters visually.
  }
}
