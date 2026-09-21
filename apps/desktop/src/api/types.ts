/**
 * Shared TypeScript types mirroring the Rust command/repository DTOs exactly (see
 * src-tauri/src/commands/*.rs and src-tauri/src/db/repositories/*.rs). Keep these in sync with
 * the Rust structs by hand — there is no shared schema generation in this phase.
 */

import type { TranslationKey } from "../lib/i18n";

export type UserRole = "owner" | "admin" | "employee";

export const USER_ROLE_LABEL_KEYS: Record<UserRole, TranslationKey> = {
  owner: "users.roleOwner",
  admin: "users.roleAdmin",
  employee: "users.roleEmployee",
};

export interface UserPublic {
  id: number;
  username: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
}

export interface SessionInfo {
  token: string;
  user: UserPublic;
  issued_at: string;
}

export interface Supplier {
  id: number;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  vat_number: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SupplierInput {
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  vat_number: string | null;
  notes: string | null;
}

export type PricingStrategy = "latest" | "average_n" | "manual";

export interface RawMaterial {
  id: number;
  name: string;
  description: string | null;
  category_id: number | null;
  base_unit_code: string;
  default_supplier_id: number | null;
  pricing_strategy: PricingStrategy;
  pricing_strategy_config: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface RawMaterialInput {
  name: string;
  description: string | null;
  category_id: number | null;
  base_unit_code: string;
  default_supplier_id: number | null;
  pricing_strategy: PricingStrategy;
  pricing_strategy_config: string | null;
  notes: string | null;
}

export interface PurchaseRecord {
  id: number;
  raw_material_id: number;
  /** A purchase may have no recorded supplier (e.g. a cash/market buy). */
  supplier_id: number | null;
  purchase_date: string;
  quantity: number;
  purchase_unit_code: string;
  total_price_micros: number;
  cost_per_base_unit_micros: number;
  expiration_date: string | null;
  notes: string | null;
  created_at: string;
  created_by_user_id: number | null;
}

export interface PurchaseRecordInput {
  raw_material_id: number;
  supplier_id: number | null;
  purchase_date: string;
  quantity: number;
  purchase_unit_code: string;
  total_price_micros: number;
  expiration_date: string | null;
  notes: string | null;
}

/**
 * The app deliberately never auto-converts weight <-> volume (see
 * src-tauri/migrations/0001_init.sql). There is no "list units" command yet, so this list is
 * hardcoded to mirror that migration's seed data exactly.
 */
export const BASE_UNIT_CODES = ["g", "kg", "ml", "l", "piece"] as const;
export type BaseUnitCode = (typeof BASE_UNIT_CODES)[number];

/** Keys into the `t()` dictionary (`lib/i18n.tsx`) — units are UI display text, so they're
 * translated like everything else rather than kept as a static English-only map. */
export const UNIT_LABEL_KEYS: Record<BaseUnitCode, TranslationKey> = {
  g: "units.g",
  kg: "units.kg",
  ml: "units.ml",
  l: "units.l",
  piece: "units.piece",
};

export type UnitKind = "weight" | "volume" | "count";

export const UNIT_KINDS: Record<BaseUnitCode, UnitKind> = {
  g: "weight",
  kg: "weight",
  ml: "volume",
  l: "volume",
  piece: "count",
};

/** Keys into the `t()` dictionary for a measurement unit's `kind` (recipes fetch units live via
 * `list_measurement_units`, whose `kind` field is a plain string, not the closed `UnitKind` union
 * above — hence `Record<string, TranslationKey>` rather than `Record<UnitKind, TranslationKey>`). */
export const UNIT_KIND_LABEL_KEYS: Record<string, TranslationKey> = {
  weight: "unitKind.weight",
  volume: "unitKind.volume",
  count: "unitKind.count",
};

export const PRICING_STRATEGIES: readonly PricingStrategy[] = ["latest", "average_n", "manual"];

export const PRICING_STRATEGY_LABELS: Record<PricingStrategy, string> = {
  latest: "Latest purchase price",
  average_n: "Average of last N purchases",
  manual: "Manual override",
};

/**
 * `commands::measurement_units::list_measurement_units` (see src-tauri/src/db/repositories/
 * measurement_units.rs). Unlike the raw-materials screen above (which predates this command and
 * hardcodes BASE_UNIT_CODES), the recipe screens fetch this list live — see
 * components/recipes/RecipesScreen.tsx for the rationale.
 */
export interface MeasurementUnit {
  code: string;
  kind: string;
  base_unit_code: string;
  to_base_factor: number;
}

export type RecipeStatus = "active" | "archived";

export type IngredientType = "raw_material" | "recipe";

export interface RecipeSummary {
  id: number;
  name: string;
  category: string | null;
  status: RecipeStatus;
  version_number: number;
  yield_quantity: number;
  yield_unit_code: string;
  updated_at: string;
}

export interface RecipeIngredient {
  id: number;
  ingredient_type: IngredientType;
  raw_material_id: number | null;
  sub_recipe_id: number | null;
  /** Denormalized for display convenience — the raw material's or sub-recipe's current name. */
  ingredient_name: string;
  quantity: number;
  unit_code: string;
  sort_order: number;
}

export interface RecipeDetail {
  id: number;
  name: string;
  description: string | null;
  category: string | null;
  instructions: string | null;
  prep_time_minutes: number | null;
  cook_time_minutes: number | null;
  status: RecipeStatus;
  notes: string | null;
  version_number: number;
  yield_quantity: number;
  yield_unit_code: string;
  ingredients: RecipeIngredient[];
  created_at: string;
  updated_at: string;
}

export interface RecipeIngredientInput {
  ingredient_type: IngredientType;
  raw_material_id: number | null;
  sub_recipe_id: number | null;
  quantity: number;
  unit_code: string;
}

export interface RecipeInput {
  name: string;
  description: string | null;
  category: string | null;
  instructions: string | null;
  prep_time_minutes: number | null;
  cook_time_minutes: number | null;
  notes: string | null;
  yield_quantity: number;
  yield_unit_code: string;
  ingredients: RecipeIngredientInput[];
}

export interface CostSnapshotSummary {
  id: number;
  calculated_at: string;
  total_cost_micros: number;
  cost_per_yield_unit_micros: number;
}

/**
 * `commands::purchase_records::list_recent_purchase_records` (see
 * src-tauri/src/db/repositories/purchase_records.rs's `RecentPurchaseRecord` struct). Cross-
 * material recent purchase activity for the dashboard's "recent price updates" feed, ordered by
 * `created_at` (when the entry was recorded), not `purchase_date`.
 */
export interface RecentPurchaseRecord {
  id: number;
  raw_material_id: number;
  raw_material_name: string;
  purchase_date: string;
  cost_per_base_unit_micros: number;
  base_unit_code: string;
  created_at: string;
}

/**
 * `commands::backup` (see src-tauri/src/db/repositories/backup_settings.rs's `BackupSettings`
 * struct). A single `destination_type = 'local'` settings row, created lazily with sensible
 * defaults on first access.
 */
export type AutoBackupFrequency = "daily" | "weekly";

export interface BackupSettings {
  id: number;
  local_path: string;
  auto_backup_enabled: boolean;
  auto_backup_frequency: AutoBackupFrequency | null;
  retention_count: number;
  last_auto_backup_at: string | null;
}

export interface BackupSettingsInput {
  /** `null` leaves the current local_path unchanged (see backup_settings::update). */
  local_path: string | null;
  auto_backup_enabled: boolean;
  auto_backup_frequency: AutoBackupFrequency | null;
  retention_count: number;
}

/**
 * `commands::backup::{create_backup, list_backups}` (see src-tauri/src/backup/mod.rs's
 * `BackupInfo` struct). `label` is non-null only for special-purpose backups such as the
 * automatic `"pre-restore-safety"` backup taken just before a restore.
 */
export interface BackupInfo {
  file_name: string;
  path: string;
  created_at: string;
  app_version: string;
  schema_version: number;
  size_bytes: number;
  label: string | null;
}

/** `commands::backup::validate_backup_file`'s `ValidatedBackupDto`. */
export interface ValidatedBackup {
  app_version: string;
  schema_version: number;
  created_at: string;
}

/**
 * `commands::cloud_backup` (see src-tauri/src/db/repositories/dropbox_settings.rs's
 * `DropboxSettings` struct). A single `destination_type = 'dropbox'` settings row, created lazily
 * with sensible defaults on first access, mirroring `BackupSettings` (local) above. The Dropbox
 * refresh token itself is never part of this DTO — it lives only in the OS keyring, never in the
 * database or serialized to the frontend (see cloud/mod.rs and docs/backup-and-updates.md §2).
 */
export interface DropboxSettings {
  id: number;
  app_key: string | null;
  cloud_account_label: string | null;
  auto_backup_enabled: boolean;
  auto_backup_frequency: AutoBackupFrequency | null;
  retention_count: number;
}

export interface DropboxSettingsInput {
  /** `null` leaves the current app_key unchanged (mirrors `BackupSettingsInput.local_path`). */
  app_key: string | null;
  auto_backup_enabled: boolean;
  auto_backup_frequency: AutoBackupFrequency | null;
  retention_count: number;
}

/** `commands::cloud_backup`'s `DropboxStatus` — settings plus whether a refresh token is stored. */
export interface DropboxStatus {
  settings: DropboxSettings;
  is_connected: boolean;
}

/** `cloud::RemoteBackupHandle`. `id` is provider-specific (Dropbox's own path) — treat as opaque. */
export interface RemoteBackupHandle {
  id: string;
  name: string;
  size_bytes: number;
  modified_at: string;
}

/**
 * `commands::updates` (see src-tauri/src/db/repositories/update_settings.rs's `UpdateSettings`
 * struct). A single settings row, created lazily with sensible defaults (auto-check on,
 * auto-download/auto-install off) on first access.
 */
export interface UpdateSettings {
  id: number;
  auto_check_enabled: boolean;
  auto_download_enabled: boolean;
  auto_install_enabled: boolean;
  last_checked_at: string | null;
}

export interface UpdateSettingsInput {
  auto_check_enabled: boolean;
  auto_download_enabled: boolean;
  auto_install_enabled: boolean;
}

/** `commands::updates::check_for_update`'s `UpdateCheckResult`. */
export interface UpdateCheckResult {
  available: boolean;
  current_version: string | null;
  version: string | null;
  notes: string | null;
}

/**
 * `commands::categories` (see src-tauri/src/db/repositories/categories.rs's `Category` struct).
 * Raw material categories are a managed entity (archive-over-delete, like suppliers), not free
 * text — `raw_materials.category_id` references these by id.
 */
export interface Category {
  id: number;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CategoryInput {
  name: string;
}

/** `commands::import::import_from_excel`'s `ImportSummary`. */
export interface ImportSummary {
  categories_created: string[];
  categories_already_existed: string[];
  products_created: string[];
  products_skipped_existing: string[];
  /** `"<row name>: <reason>"` for a row that couldn't be created at all. */
  products_skipped_invalid: string[];
}
