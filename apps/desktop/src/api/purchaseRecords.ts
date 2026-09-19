import { invoke } from "@tauri-apps/api/core";
import type { PurchaseRecord, PurchaseRecordInput } from "./types";

/**
 * Typed wrappers around the `commands::purchase_records` Tauri commands. This is the only module
 * that should call `invoke()` for purchase records — components call these functions instead.
 *
 * Deliberately no update/delete wrapper: purchase history is append-only (see
 * src-tauri/src/db/repositories/purchase_records.rs).
 */

export function listPurchaseRecordsForMaterial(rawMaterialId: number): Promise<PurchaseRecord[]> {
  return invoke("list_purchase_records_for_material", { rawMaterialId });
}

export function createPurchaseRecord(input: PurchaseRecordInput): Promise<PurchaseRecord> {
  return invoke("create_purchase_record", { input });
}
