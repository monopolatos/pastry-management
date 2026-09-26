/**
 * User-picked color overrides for the app's broad visual roles (brand/primary, background, body
 * text, label/secondary text) — separate from and layered on top of the light/dark/system theme
 * (`next-themes`, see main.tsx). Applied as inline styles on `<html>`, which beats both `:root`
 * and `.dark` class selector rules in CSS specificity, so a custom color sticks regardless of
 * which light/dark theme is active; "Reset to defaults" just removes the inline overrides and
 * lets the underlying theme's own values show through again.
 *
 * Each role maps to several of shadcn's CSS variables at once (see CUSTOM_THEME_VAR_MAP) — e.g.
 * picking one "Background" color needs to repaint `--background`, `--card`, `--popover`, and
 * `--sidebar` together, since nearly all visible content sits inside a Card/Popover/Sidebar, each
 * with its own surface-color variable. Applying only `--background` would leave most of the app
 * looking unchanged.
 */

export type CustomThemeRole = "primary" | "background" | "text" | "labels";

export type CustomThemeColors = Partial<Record<CustomThemeRole, string>>;

const STORAGE_KEY = "pastry-management.customTheme";

const CUSTOM_THEME_VAR_MAP: Record<CustomThemeRole, string[]> = {
  primary: ["--primary", "--sidebar-primary", "--ring", "--sidebar-ring"],
  background: ["--background", "--card", "--popover", "--sidebar"],
  text: ["--foreground", "--card-foreground", "--popover-foreground", "--sidebar-foreground"],
  labels: ["--muted-foreground"],
};

/** Vars whose readable-text counterpart must be recomputed (not just copied) whenever this role's
 * color changes, since e.g. a light "primary" needs dark text on it and vice versa. Each entry's
 * foreground var is set to whichever of black/white contrasts better with the picked color. */
const CONTRAST_FOREGROUND_VARS: Partial<Record<CustomThemeRole, string[]>> = {
  primary: ["--primary-foreground", "--sidebar-primary-foreground"],
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

/** Given a `#rrggbb` color, returns whichever of black/white gives better contrast against it, per
 * the standard perceived-brightness (YIQ) heuristic — good enough for picking legible button/badge
 * text, not a full WCAG contrast calculation. */
function readableForegroundFor(hex: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return "#ffffff";
  const int = parseInt(match[1], 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness >= 140 ? "#000000" : "#ffffff";
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
    const foregroundVars = CONTRAST_FOREGROUND_VARS[role];
    if (foregroundVars) {
      const foreground = readableForegroundFor(value);
      for (const cssVar of foregroundVars) {
        root.style.setProperty(cssVar, foreground);
      }
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

/** Removes just one role's override — both its inline styles and its persisted value — leaving
 * every other role's override in place. */
export function clearCustomThemeRole(role: CustomThemeRole): CustomThemeColors {
  const root = document.documentElement;
  for (const cssVar of CUSTOM_THEME_VAR_MAP[role]) {
    root.style.removeProperty(cssVar);
  }
  for (const cssVar of CONTRAST_FOREGROUND_VARS[role] ?? []) {
    root.style.removeProperty(cssVar);
  }
  const current = readCustomTheme();
  delete current[role];
  persist(current);
  return current;
}

/** Removes every override, both the inline styles and the persisted record. */
export function resetCustomTheme(): void {
  const root = document.documentElement;
  for (const vars of Object.values(CUSTOM_THEME_VAR_MAP)) {
    for (const cssVar of vars) {
      root.style.removeProperty(cssVar);
    }
  }
  for (const vars of Object.values(CONTRAST_FOREGROUND_VARS)) {
    for (const cssVar of vars ?? []) {
      root.style.removeProperty(cssVar);
    }
  }
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing further to do — the inline styles are already gone, which is what matters visually.
  }
}
