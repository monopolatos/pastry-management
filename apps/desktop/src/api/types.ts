/**
 * Shared TypeScript types mirroring the Rust command/repository DTOs exactly (see
 * src-tauri/src/commands/*.rs and src-tauri/src/db/repositories/*.rs). Keep these in sync with
 * the Rust structs by hand — there is no shared schema generation in this phase.
 */

export type UserRole = "owner" | "admin" | "employee";

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
  category: string | null;
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
  category: string | null;
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

export const UNIT_LABELS: Record<BaseUnitCode, string> = {
  g: "Grams (g)",
  kg: "Kilograms (kg)",
  ml: "Milliliters (ml)",
  l: "Liters (l)",
  piece: "Piece",
};

export type UnitKind = "weight" | "volume" | "count";

export const UNIT_KINDS: Record<BaseUnitCode, UnitKind> = {
  g: "weight",
  kg: "weight",
  ml: "volume",
  l: "volume",
  piece: "count",
};

export const PRICING_STRATEGIES: readonly PricingStrategy[] = ["latest", "average_n", "manual"];

export const PRICING_STRATEGY_LABELS: Record<PricingStrategy, string> = {
  latest: "Latest purchase price",
  average_n: "Average of last N purchases",
  manual: "Manual override",
};
