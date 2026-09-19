import { invoke } from "@tauri-apps/api/core";
import type { MeasurementUnit } from "./types";

/**
 * Typed wrapper around `commands::measurement_units::list_measurement_units`. This is the only
 * module that should call `invoke()` for measurement units — components call this instead.
 *
 * There is no create/update/delete here — the set of units is fixed at the schema level (see
 * src-tauri/src/db/repositories/measurement_units.rs).
 */
export function listMeasurementUnits(): Promise<MeasurementUnit[]> {
  return invoke("list_measurement_units");
}
