import { describe, expect, it } from "vitest";
import { MissingIngredientCostError } from "../costing/errors.js";
import type { CostingRawMaterial } from "../costing/types.js";
import { resolveRawMaterialPrice } from "./resolve.js";

function material(overrides: Partial<CostingRawMaterial>): CostingRawMaterial {
  return {
    id: 1,
    name: "Flour",
    base_unit_code: "g",
    pricing_strategy: "latest",
    pricing_strategy_config: null,
    purchase_history: [],
    ...overrides,
  };
}

describe("resolveRawMaterialPrice", () => {
  describe("latest strategy", () => {
    it("picks the most recent purchase regardless of array order", () => {
      const m = material({
        pricing_strategy: "latest",
        purchase_history: [
          { purchase_date: "2026-01-10", cost_per_base_unit_micros: 2000, supplier_name: "Old Co" },
          { purchase_date: "2026-06-15", cost_per_base_unit_micros: 2500, supplier_name: "New Co" },
          { purchase_date: "2026-03-01", cost_per_base_unit_micros: 2200, supplier_name: "Mid Co" },
        ],
      });
      const resolved = resolveRawMaterialPrice(m);
      expect(resolved.strategy).toBe("latest");
      expect(resolved.costPerBaseUnitMicros.toNumber()).toBe(2500);
      expect(resolved.sourceDescription).toBe("latest purchase, 2026-06-15, New Co");
    });

    it("describes a purchase with no recorded supplier", () => {
      const m = material({
        purchase_history: [
          { purchase_date: "2026-06-15", cost_per_base_unit_micros: 2500, supplier_name: null },
        ],
      });
      const resolved = resolveRawMaterialPrice(m);
      expect(resolved.sourceDescription).toBe("latest purchase, 2026-06-15 (no supplier recorded)");
    });

    it("throws MissingIngredientCostError when purchase_history is empty", () => {
      const m = material({ purchase_history: [] });
      expect(() => resolveRawMaterialPrice(m)).toThrow(MissingIngredientCostError);
    });

    it("respects asOfDate, picking the latest purchase on/before that date", () => {
      const m = material({
        purchase_history: [
          { purchase_date: "2026-01-10", cost_per_base_unit_micros: 2000, supplier_name: "Old Co" },
          { purchase_date: "2026-06-15", cost_per_base_unit_micros: 2500, supplier_name: "New Co" },
        ],
      });
      const resolved = resolveRawMaterialPrice(m, "2026-03-01");
      expect(resolved.costPerBaseUnitMicros.toNumber()).toBe(2000);
      expect(resolved.sourceDescription).toBe("latest purchase, 2026-01-10, Old Co");
    });

    it("throws MissingIngredientCostError when asOfDate predates every purchase", () => {
      const m = material({
        purchase_history: [
          { purchase_date: "2026-06-15", cost_per_base_unit_micros: 2500, supplier_name: null },
        ],
      });
      expect(() => resolveRawMaterialPrice(m, "2026-01-01")).toThrow(MissingIngredientCostError);
    });
  });

  describe("average_n strategy", () => {
    it("averages the most recent N purchases per configured n", () => {
      const m = material({
        pricing_strategy: "average_n",
        pricing_strategy_config: '{"n":2}',
        purchase_history: [
          { purchase_date: "2026-01-01", cost_per_base_unit_micros: 1000, supplier_name: null },
          { purchase_date: "2026-02-01", cost_per_base_unit_micros: 2000, supplier_name: null },
          { purchase_date: "2026-03-01", cost_per_base_unit_micros: 3000, supplier_name: null },
        ],
      });
      const resolved = resolveRawMaterialPrice(m);
      // most recent 2: 3000 (Mar) and 2000 (Feb) -> average 2500
      expect(resolved.costPerBaseUnitMicros.toNumber()).toBe(2500);
      expect(resolved.sourceDescription).toBe("average of last 2 purchases");
    });

    it("defaults n to 5 when config is missing", () => {
      const m = material({
        pricing_strategy: "average_n",
        pricing_strategy_config: null,
        purchase_history: [
          { purchase_date: "2026-01-01", cost_per_base_unit_micros: 1000, supplier_name: null },
          { purchase_date: "2026-02-01", cost_per_base_unit_micros: 1000, supplier_name: null },
        ],
      });
      const resolved = resolveRawMaterialPrice(m);
      expect(resolved.costPerBaseUnitMicros.toNumber()).toBe(1000);
      expect(resolved.sourceDescription).toBe("average of last 2 purchases");
    });

    it("defaults n to 5 when config is malformed JSON", () => {
      const m = material({
        pricing_strategy: "average_n",
        pricing_strategy_config: "not json",
        purchase_history: [
          { purchase_date: "2026-01-01", cost_per_base_unit_micros: 4000, supplier_name: null },
        ],
      });
      const resolved = resolveRawMaterialPrice(m);
      expect(resolved.costPerBaseUnitMicros.toNumber()).toBe(4000);
    });

    it("respects asOfDate before averaging", () => {
      const m = material({
        pricing_strategy: "average_n",
        pricing_strategy_config: '{"n":2}',
        purchase_history: [
          { purchase_date: "2026-01-01", cost_per_base_unit_micros: 1000, supplier_name: null },
          { purchase_date: "2026-02-01", cost_per_base_unit_micros: 2000, supplier_name: null },
          { purchase_date: "2026-03-01", cost_per_base_unit_micros: 3000, supplier_name: null },
        ],
      });
      // as of Feb 1: eligible are Jan (1000) and Feb (2000); most recent 2 -> average 1500
      const resolved = resolveRawMaterialPrice(m, "2026-02-01");
      expect(resolved.costPerBaseUnitMicros.toNumber()).toBe(1500);
    });

    it("keeps full (non-rounded) precision for repeating decimals", () => {
      const m = material({
        pricing_strategy: "average_n",
        pricing_strategy_config: '{"n":3}',
        purchase_history: [
          { purchase_date: "2026-01-01", cost_per_base_unit_micros: 10000, supplier_name: null },
          { purchase_date: "2026-02-01", cost_per_base_unit_micros: 10000, supplier_name: null },
          { purchase_date: "2026-03-01", cost_per_base_unit_micros: 10001, supplier_name: null },
        ],
      });
      const resolved = resolveRawMaterialPrice(m);
      // 30001 / 3 = 10000.333... — must NOT be pre-rounded to 10000.
      expect(resolved.costPerBaseUnitMicros.toString()).toBe("10000.333333333333333");
    });

    it("throws MissingIngredientCostError when no purchase is eligible", () => {
      const m = material({ pricing_strategy: "average_n", purchase_history: [] });
      expect(() => resolveRawMaterialPrice(m)).toThrow(MissingIngredientCostError);
    });
  });

  describe("manual strategy", () => {
    it("uses the configured manual price, ignoring purchase history", () => {
      const m = material({
        pricing_strategy: "manual",
        pricing_strategy_config: '{"manual_price_micros":2500}',
        purchase_history: [
          { purchase_date: "2026-01-01", cost_per_base_unit_micros: 999999, supplier_name: null },
        ],
      });
      const resolved = resolveRawMaterialPrice(m);
      expect(resolved.costPerBaseUnitMicros.toNumber()).toBe(2500);
      expect(resolved.sourceDescription).toBe("manual override price");
    });

    it("throws MissingIngredientCostError when config is missing", () => {
      const m = material({ pricing_strategy: "manual", pricing_strategy_config: null });
      expect(() => resolveRawMaterialPrice(m)).toThrow(MissingIngredientCostError);
    });

    it("throws MissingIngredientCostError when config is malformed", () => {
      const m = material({
        pricing_strategy: "manual",
        pricing_strategy_config: "{not valid json",
      });
      expect(() => resolveRawMaterialPrice(m)).toThrow(MissingIngredientCostError);
    });

    it("throws MissingIngredientCostError when config lacks manual_price_micros", () => {
      const m = material({ pricing_strategy: "manual", pricing_strategy_config: '{"other":1}' });
      expect(() => resolveRawMaterialPrice(m)).toThrow(MissingIngredientCostError);
    });
  });
});
