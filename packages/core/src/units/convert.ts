import Decimal from "decimal.js";
import { IncompatibleUnitError, UnknownUnitError } from "../costing/errors.js";
import type { CostingUnit } from "../costing/types.js";

/** Build a code -> CostingUnit lookup map from the flat units array in a RecipeCostingGraph. */
export function buildUnitsByCode(units: CostingUnit[]): Map<string, CostingUnit> {
  return new Map(units.map((unit) => [unit.code, unit]));
}

/**
 * Convert `quantity` (expressed in `fromUnitCode`) into the equivalent quantity
 * expressed in `toUnitCode`. Full Decimal precision, no rounding.
 *
 * Two units convert into each other only if they share the same `kind`
 * (weight/weight, volume/volume, count/count) — weight and volume are never
 * auto-converted into each other, no matter what (per costing-engine.md §7/§12.2).
 *
 * Throws UnknownUnitError if either unit_code is absent from `unitsByCode`,
 * or IncompatibleUnitError if the two units belong to different UnitKinds.
 */
export function convertQuantity(
  quantity: number | Decimal,
  fromUnitCode: string,
  toUnitCode: string,
  unitsByCode: Map<string, CostingUnit>,
): Decimal {
  const fromUnit = unitsByCode.get(fromUnitCode);
  if (!fromUnit) {
    throw new UnknownUnitError(fromUnitCode);
  }
  const toUnit = unitsByCode.get(toUnitCode);
  if (!toUnit) {
    throw new UnknownUnitError(toUnitCode);
  }
  if (fromUnit.kind !== toUnit.kind) {
    throw new IncompatibleUnitError(fromUnitCode, toUnitCode, fromUnit.kind, toUnit.kind);
  }

  return new Decimal(quantity).mul(fromUnit.to_base_factor).div(toUnit.to_base_factor);
}
