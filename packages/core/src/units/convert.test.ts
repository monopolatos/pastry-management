import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { IncompatibleUnitError, UnknownUnitError } from "../costing/errors.js";
import type { CostingUnit } from "../costing/types.js";
import { buildUnitsByCode, convertQuantity } from "./convert.js";

// The 5 seeded units per costing-engine.md / database-schema.md.
const UNITS: CostingUnit[] = [
  { code: "g", kind: "weight", to_base_factor: 1 },
  { code: "kg", kind: "weight", to_base_factor: 1000 },
  { code: "ml", kind: "volume", to_base_factor: 1 },
  { code: "l", kind: "volume", to_base_factor: 1000 },
  { code: "piece", kind: "count", to_base_factor: 1 },
];

describe("convertQuantity", () => {
  const unitsByCode = buildUnitsByCode(UNITS);

  it("converts within the same kind (weight -> weight)", () => {
    const result = convertQuantity(2, "kg", "g", unitsByCode);
    expect(result.toNumber()).toBe(2000);
  });

  it("converts within the same kind (volume -> volume)", () => {
    const result = convertQuantity(1500, "ml", "l", unitsByCode);
    expect(result.toNumber()).toBe(1.5);
  });

  it("is a no-op when converting a unit to itself", () => {
    const result = convertQuantity(42, "g", "g", unitsByCode);
    expect(result.toNumber()).toBe(42);
  });

  it("handles count units", () => {
    const result = convertQuantity(4, "piece", "piece", unitsByCode);
    expect(result.toNumber()).toBe(4);
  });

  it("returns a Decimal instance for full-precision downstream math", () => {
    const result = convertQuantity(1, "g", "g", unitsByCode);
    expect(result).toBeInstanceOf(Decimal);
  });

  it("throws IncompatibleUnitError converting weight -> volume", () => {
    expect(() => convertQuantity(500, "g", "ml", unitsByCode)).toThrow(IncompatibleUnitError);
  });

  it("throws IncompatibleUnitError converting volume -> weight", () => {
    expect(() => convertQuantity(500, "l", "kg", unitsByCode)).toThrow(IncompatibleUnitError);
  });

  it("throws IncompatibleUnitError converting count -> weight", () => {
    expect(() => convertQuantity(1, "piece", "g", unitsByCode)).toThrow(IncompatibleUnitError);
  });

  it("throws UnknownUnitError for an unrecognized source unit", () => {
    expect(() => convertQuantity(1, "gallon", "g", unitsByCode)).toThrow(UnknownUnitError);
  });

  it("throws UnknownUnitError for an unrecognized target unit", () => {
    expect(() => convertQuantity(1, "g", "gallon", unitsByCode)).toThrow(UnknownUnitError);
  });

  it("sets the distinguishing error code on thrown errors", () => {
    try {
      convertQuantity(1, "g", "ml", unitsByCode);
      expect.unreachable();
    } catch (err) {
      expect((err as { code: string }).code).toBe("INCOMPATIBLE_UNIT");
    }

    try {
      convertQuantity(1, "gallon", "g", unitsByCode);
      expect.unreachable();
    } catch (err) {
      expect((err as { code: string }).code).toBe("UNKNOWN_UNIT");
    }
  });
});
