import { invoke } from "@tauri-apps/api/core";
import type { Supplier, SupplierInput } from "./types";

/**
 * Typed wrappers around the `commands::suppliers` Tauri commands. This is the only module that
 * should call `invoke()` for suppliers — components call these functions instead.
 *
 * Note: Tauri camelCases top-level command argument names for the JS side (e.g. Rust's
 * `include_inactive` becomes `includeInactive` here), but does NOT rename fields inside a struct
 * argument like `SupplierInput` — those keep their exact snake_case Rust field names since that
 * struct has no `#[serde(rename_all = ...)]`.
 */

export function listSuppliers(includeInactive: boolean): Promise<Supplier[]> {
  return invoke("list_suppliers", { includeInactive });
}

export function getSupplier(id: number): Promise<Supplier> {
  return invoke("get_supplier", { id });
}

export function createSupplier(input: SupplierInput): Promise<Supplier> {
  return invoke("create_supplier", { input });
}

export function updateSupplier(id: number, input: SupplierInput): Promise<Supplier> {
  return invoke("update_supplier", { id, input });
}

export function archiveSupplier(id: number): Promise<void> {
  return invoke("archive_supplier", { id });
}

export function reactivateSupplier(id: number): Promise<void> {
  return invoke("reactivate_supplier", { id });
}

export function deleteSupplier(id: number): Promise<void> {
  return invoke("delete_supplier", { id });
}
