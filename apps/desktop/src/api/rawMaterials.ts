import { invoke } from "@tauri-apps/api/core";
import type { RawMaterial, RawMaterialInput } from "./types";

/**
 * Typed wrappers around the `commands::raw_materials` Tauri commands. This is the only module
 * that should call `invoke()` for raw materials — components call these functions instead.
 */

export function listRawMaterials(includeInactive: boolean): Promise<RawMaterial[]> {
  return invoke("list_raw_materials", { includeInactive });
}

export function getRawMaterial(id: number): Promise<RawMaterial> {
  return invoke("get_raw_material", { id });
}

export function createRawMaterial(input: RawMaterialInput): Promise<RawMaterial> {
  return invoke("create_raw_material", { input });
}

export function updateRawMaterial(id: number, input: RawMaterialInput): Promise<RawMaterial> {
  return invoke("update_raw_material", { id, input });
}

export function archiveRawMaterial(id: number): Promise<void> {
  return invoke("archive_raw_material", { id });
}

export function reactivateRawMaterial(id: number): Promise<void> {
  return invoke("reactivate_raw_material", { id });
}

export function deleteRawMaterial(id: number): Promise<void> {
  return invoke("delete_raw_material", { id });
}
