import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";

/**
 * Minimal, architecture-ready i18n scaffold (Phase 5 decision: ship English only for now, but
 * don't hardcode strings in a way that blocks adding Greek later — see docs/architecture.md).
 *
 * This is intentionally a plain key -> string lookup, not a full i18n library (react-i18next,
 * etc.) — the app doesn't need plural rules, interpolation, or lazy-loaded translation bundles
 * yet, and pulling in that machinery now for a single supported locale would be overengineering.
 * When Greek support actually lands, add an "el" entry to `dictionaries` below with the same key
 * set; TypeScript will then flag any missing key at compile time.
 *
 * Scope note: only Phase 5's new/restyled surfaces (nav, Dashboard, Cost Calculator, Settings,
 * User Profile) route their strings through `t()`. Retrofitting every string in the Phase 3/4
 * screens (raw materials, suppliers, recipes forms) into this dictionary is a follow-up task, not
 * done as part of this pass — see docs/roadmap.md's Phase 5 notes.
 */

export type Locale = "en";

export const SUPPORTED_LOCALES: readonly Locale[] = ["en"];

const dictionaries = {
  en: {
    "app.title": "Pastry Management",
    "nav.dashboard": "Dashboard",
    "nav.rawMaterials": "Raw Materials",
    "nav.suppliers": "Suppliers",
    "nav.recipes": "Recipes",
    "nav.costCalculator": "Cost Calculator",
    "nav.backup": "Backup & Restore",
    "nav.settings": "Settings",
    "nav.profile": "User Profile",
    "nav.users": "Users",
    "common.save": "Save",
    "common.cancel": "Cancel",
    "common.delete": "Delete",
    "common.edit": "Edit",
    "common.archive": "Archive",
    "common.reactivate": "Reactivate",
    "common.loading": "Loading…",
    "common.comingSoon": "Coming soon",
    "common.logout": "Log out",

    "dashboard.title": "Dashboard",
    "dashboard.activeRawMaterials": "Active Raw Materials",
    "dashboard.activeRecipes": "Active Recipes",
    "dashboard.activeSuppliers": "Active Suppliers",
    "dashboard.recentRecipes": "Recently Modified Recipes",
    "dashboard.noRecentRecipes": "No recipes yet.",
    "dashboard.recentPriceUpdates": "Recent Price Updates",
    "dashboard.noRecentPurchases": "No purchases recorded yet.",
    "dashboard.backupStatus": "Backup Status",
    "dashboard.backupNotConfigured":
      "Not configured yet. Backup & Restore is coming in a future update.",
    "dashboard.loadError": "Could not load dashboard data.",

    "costCalculator.title": "Cost Calculator",
    "costCalculator.description":
      "Pick an active recipe to see its current cost breakdown — the same calculation used on the Recipes screen.",
    "costCalculator.selectRecipe": "Recipe",
    "costCalculator.selectPlaceholder": "Select a recipe…",
    "costCalculator.noRecipes": "No active recipes yet.",
    "costCalculator.calculating": "Calculating…",
    "costCalculator.empty": "Select a recipe above to see its cost breakdown.",

    "backup.title": "Backup & Restore",
    "backup.settingsTitle": "Backup Settings",
    "backup.directory": "Backup folder",
    "backup.chooseFolder": "Choose folder…",
    "backup.folderUpdated": "Backup folder updated.",
    "backup.autoBackup": "Automatic backups",
    "backup.autoBackupHint": "Create a backup automatically on a schedule.",
    "backup.frequency": "Frequency",
    "backup.frequencyPlaceholder": "Select a frequency…",
    "backup.frequencyDaily": "Daily",
    "backup.frequencyWeekly": "Weekly",
    "backup.frequencyRequired": "Choose a frequency for automatic backups, or turn them off.",
    "backup.retentionCount": "Keep this many backups",
    "backup.retentionInvalid": "Must keep at least 1 backup.",
    "backup.autoCheckNote":
      "Automatic backups are checked once each time the app launches, not continuously in the background — so a backup is only taken if one is actually due when you open the app.",
    "backup.saveSettings": "Save settings",
    "backup.settingsSaved": "Backup settings saved.",
    "backup.backupsTitle": "Backups",
    "backup.createNow": "Create backup now",
    "backup.createSuccess": "Backup created.",
    "backup.empty": "No backups yet — create one to get started.",
    "backup.createdAt": "Created",
    "backup.size": "Size",
    "backup.actions": "Actions",
    "backup.preRestoreSafetyLabel": "pre-restore-safety",
    "backup.validate": "Validate",
    "backup.validateSuccess": "Backup is valid —",
    "backup.restore": "Restore",
    "backup.restoreConfirmTitle": "Restore this backup?",
    "backup.restoreConfirmBody":
      "This replaces all current data with the contents of this backup. A safety backup of your current data is taken automatically first, so you can undo this by restoring that one if needed. This cannot be undone from within the app.",
    "backup.restoreSuccess":
      "Restore complete. The app now reflects the restored data — no restart needed.",
    "backup.deleteConfirmTitle": "Delete this backup?",
    "backup.deleteConfirmBody": "This permanently deletes the backup file. This cannot be undone.",

    "settings.title": "Settings",
    "settings.theme": "Theme",
    "settings.themeLight": "Light",
    "settings.themeDark": "Dark",
    "settings.themeSystem": "System",
    "settings.language": "Language",
    "settings.languageNote": "More languages coming soon.",
    "settings.currency": "Currency",
    "settings.currencyNote":
      "The app currently assumes EUR throughout. Multi-currency support may be added in a future update.",

    "profile.title": "User Profile",
    "profile.username": "Username",
    "profile.role": "Role",
    "profile.createdAt": "Account created",
    "profile.changePassword": "Change Password",
    "profile.currentPassword": "Current password",
    "profile.newPassword": "New password",
    "profile.confirmPassword": "Confirm new password",
    "profile.passwordMismatch": "New password and confirmation do not match.",
    "profile.passwordChanged": "Password changed successfully.",
    "profile.changePasswordAction": "Change password",
  },
} as const satisfies Record<Locale, Record<string, string>>;

export type TranslationKey = keyof (typeof dictionaries)["en"];

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>("en");

  const value: I18nContextValue = {
    locale,
    setLocale,
    t: (key) => dictionaries[locale][key],
  };

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return ctx;
}
