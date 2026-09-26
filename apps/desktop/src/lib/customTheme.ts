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
 *
 * Some roles also drive DERIVED (not identical-copy) variables — see DERIVED_VARS — because a
 * plain copy would look wrong: a picked "primary" needs *contrasting* button text, not text the
 * same color as the button, and a picked "background" needs borders that are a shade apart from
 * it, not literally the same color (which would make every border invisible) or left at their old
 * fixed color (which clashes once the background is no longer near-white).
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

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function parseHex(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const int = parseInt(match[1], 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => clamp255(c).toString(16).padStart(2, "0")).join("")}`;
}

/** Perceived brightness (YIQ heuristic), 0-255. Good enough for light/dark UI decisions, not a
 * full WCAG contrast calculation. */
function brightnessOf(r: number, g: number, b: number): number {
  return (r * 299 + g * 587 + b * 114) / 1000;
}

/** Given a `#rrggbb` color, returns whichever of black/white gives better contrast against it —
 * e.g. legible text on a button/badge painted with that color. */
function readableForegroundFor(hex: string): string {
  const rgb = parseHex(hex);
  if (!rgb) return "#ffffff";
  return brightnessOf(...rgb) >= 140 ? "#000000" : "#ffffff";
}

/** A border/input shade that stays visibly (but subtly) separated from a custom background:
 * darkened a bit for a light background, lightened more for a dark one (dark surfaces need a
 * bigger nudge to read as a distinct border at all). A fixed border color would either nearly
 * vanish or badly clash depending on how light/dark the picked background is. */
function deriveBorderShade(hex: string): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const [r, g, b] = rgb;
  const isLight = brightnessOf(r, g, b) >= 140;
  const target = isLight ? 0 : 255;
  const amount = isLight ? 0.12 : 0.22;
  return toHex(r + (target - r) * amount, g + (target - g) * amount, b + (target - b) * amount);
}

/** Variables a role drives with a DERIVED value (via `derive`) rather than a plain copy of the
 * picked color — see the module doc comment for why. */
const DERIVED_VARS: Partial<
  Record<CustomThemeRole, { vars: string[]; derive: (hex: string) => string }>
> = {
  primary: {
    vars: ["--primary-foreground", "--sidebar-primary-foreground"],
    derive: readableForegroundFor,
  },
  background: {
    vars: ["--border", "--input", "--sidebar-border"],
    derive: deriveBorderShade,
  },
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
    const derived = DERIVED_VARS[role];
    if (derived) {
      const derivedValue = derived.derive(value);
      for (const cssVar of derived.vars) {
        root.style.setProperty(cssVar, derivedValue);
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
  for (const cssVar of DERIVED_VARS[role]?.vars ?? []) {
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
  for (const derived of Object.values(DERIVED_VARS)) {
    for (const cssVar of derived?.vars ?? []) {
      root.style.removeProperty(cssVar);
    }
  }
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing further to do — the inline styles are already gone, which is what matters visually.
  }
}
