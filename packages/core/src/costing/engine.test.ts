import { describe, expect, it } from "vitest";
import {
  ArchivedReferenceError,
  CircularDependencyError,
  ExcessiveNestingError,
  IncompatibleUnitError,
  InvalidYieldError,
  MissingIngredientCostError,
  UnknownUnitError,
} from "./errors.js";
import { calculateRecipeCost } from "./engine.js";
import type {
  CostingIngredient,
  CostingPurchaseRecord,
  CostingRawMaterial,
  CostingRecipeNode,
  CostingUnit,
  RecipeCostingGraph,
} from "./types.js";

// The 5 seeded units, per costing-engine.md / database-schema.md.
const UNITS: CostingUnit[] = [
  { code: "g", kind: "weight", to_base_factor: 1 },
  { code: "kg", kind: "weight", to_base_factor: 1000 },
  { code: "ml", kind: "volume", to_base_factor: 1 },
  { code: "l", kind: "volume", to_base_factor: 1000 },
  { code: "piece", kind: "count", to_base_factor: 1 },
];

function purchase(overrides: Partial<CostingPurchaseRecord>): CostingPurchaseRecord {
  return {
    purchase_date: "2026-01-01",
    cost_per_base_unit_micros: 0,
    supplier_name: null,
    ...overrides,
  };
}

function rawMaterial(
  overrides: Partial<CostingRawMaterial> & { id: number; name: string },
): CostingRawMaterial {
  return {
    base_unit_code: "g",
    pricing_strategy: "latest",
    pricing_strategy_config: null,
    purchase_history: [],
    ...overrides,
  };
}

function ingredient(overrides: Partial<CostingIngredient>): CostingIngredient {
  return {
    ingredient_type: "raw_material",
    raw_material_id: null,
    sub_recipe_id: null,
    quantity: 1,
    unit_code: "g",
    ...overrides,
  };
}

function recipe(
  overrides: Partial<CostingRecipeNode> & { id: number; name: string },
): CostingRecipeNode {
  return {
    status: "active",
    yield_quantity: 1,
    yield_unit_code: "g",
    ingredients: [],
    ...overrides,
  };
}

function graph(
  overrides: Partial<RecipeCostingGraph> & { target_recipe_id: number },
): RecipeCostingGraph {
  return {
    recipes: [],
    raw_materials: [],
    units: UNITS,
    ...overrides,
  };
}

describe("calculateRecipeCost — worked example (costing-engine.md §4/§12.4)", () => {
  // Chocolate: €0.01/g
  const chocolate = rawMaterial({
    id: 1,
    name: "Chocolate",
    base_unit_code: "g",
    purchase_history: [
      purchase({ cost_per_base_unit_micros: 10000, supplier_name: "Cocoa Supplies" }),
    ],
  });
  // Cream: ~€0.006667/ml (chosen so 300ml ~= €2.00)
  const cream = rawMaterial({
    id: 2,
    name: "Cream",
    base_unit_code: "ml",
    purchase_history: [purchase({ cost_per_base_unit_micros: 6667, supplier_name: "Dairy Co" })],
  });
  // Butter: €0.02/g
  const butter = rawMaterial({
    id: 3,
    name: "Butter",
    base_unit_code: "g",
    purchase_history: [purchase({ cost_per_base_unit_micros: 20000, supplier_name: "Dairy Co" })],
  });
  const ganache = recipe({
    id: 10,
    name: "Ganache",
    yield_quantity: 800,
    yield_unit_code: "g",
    ingredients: [
      ingredient({ raw_material_id: 1, quantity: 500, unit_code: "g" }),
      ingredient({ raw_material_id: 2, quantity: 300, unit_code: "ml" }),
      ingredient({ raw_material_id: 3, quantity: 50, unit_code: "g" }),
    ],
  });

  // Flour: €0.0025/g, Sugar: €0.002/g, Eggs: €0.30/piece = 300000 micros/piece.
  // (The design doc's illustrative "30000" for eggs is a typo missing a trailing
  // zero — 30000 micros/piece would be €0.03/egg and would not reproduce the
  // doc's own stated €1.20 egg line / €5.05 total; 300000 micros/piece does.)
  const flour = rawMaterial({
    id: 4,
    name: "Flour",
    base_unit_code: "g",
    purchase_history: [purchase({ cost_per_base_unit_micros: 2500 })],
  });
  const sugar = rawMaterial({
    id: 5,
    name: "Sugar",
    base_unit_code: "g",
    purchase_history: [purchase({ cost_per_base_unit_micros: 2000 })],
  });
  const eggs = rawMaterial({
    id: 6,
    name: "Eggs",
    base_unit_code: "piece",
    purchase_history: [purchase({ cost_per_base_unit_micros: 300000 })],
  });
  const cake = recipe({
    id: 20,
    name: "Chocolate Cake",
    yield_quantity: 10,
    yield_unit_code: "piece",
    ingredients: [
      ingredient({ raw_material_id: 4, quantity: 500, unit_code: "g" }),
      ingredient({ raw_material_id: 5, quantity: 300, unit_code: "g" }),
      ingredient({ raw_material_id: 6, quantity: 4, unit_code: "piece" }),
      ingredient({ ingredient_type: "recipe", sub_recipe_id: 10, quantity: 200, unit_code: "g" }),
    ],
  });

  const testGraph = graph({
    target_recipe_id: 20,
    recipes: [ganache, cake],
    raw_materials: [chocolate, cream, butter, flour, sugar, eggs],
  });

  it("computes the Ganache sub-recipe's own breakdown correctly", () => {
    const ganacheOnly = calculateRecipeCost(
      graph({
        target_recipe_id: 10,
        recipes: [ganache],
        raw_materials: [chocolate, cream, butter],
      }),
    );
    expect(ganacheOnly.lines).toHaveLength(3);
    expect(ganacheOnly.lines[0]?.lineCostMicros).toBe(5_000_000); // 500g x 10000 = €5.00
    expect(ganacheOnly.lines[1]?.lineCostMicros).toBe(2_000_100); // 300ml x 6667 = €2.0001
    expect(ganacheOnly.lines[2]?.lineCostMicros).toBe(1_000_000); // 50g x 20000 = €1.00
    expect(ganacheOnly.totalCostMicros).toBe(8_000_100); // ~= €8.00
    // 8_000_100 / 800 = 10000.125 micros/g, rounds to 10000 -> exactly €0.01/g
    expect(ganacheOnly.costPerYieldUnitMicros).toBe(10_000);
  });

  it("reproduces the Chocolate Cake worked example exactly", () => {
    const result = calculateRecipeCost(testGraph);

    expect(result.lines).toHaveLength(4);
    expect(result.lines[0]?.lineCostMicros).toBe(1_250_000); // flour: 500g x 2500 = €1.25
    expect(result.lines[1]?.lineCostMicros).toBe(600_000); // sugar: 300g x 2000 = €0.60
    expect(result.lines[2]?.lineCostMicros).toBe(1_200_000); // eggs: 4 x 300000 = €1.20
    expect(result.lines[3]?.lineCostMicros).toBe(2_000_000); // ganache: 200g x 10000 = €2.00
    expect(result.lines[3]?.subBreakdown).toBeDefined();
    expect(result.lines[3]?.subBreakdown?.recipeId).toBe(10);

    expect(result.totalCostMicros).toBe(5_050_000); // €5.05 exactly
    expect(result.costPerYieldUnitMicros).toBe(505_000); // €0.505 exactly

    const percentSum = result.lines.reduce((acc, l) => acc + l.percentOfTotal, 0);
    expect(percentSum).toBeCloseTo(100, 9);
  });

  it("includes every distinct raw material resolved anywhere in the subtree in pricingStrategyUsed", () => {
    const result = calculateRecipeCost(testGraph);
    const ids = result.pricingStrategyUsed.map((p) => p.rawMaterialId).sort((a, b) => a - b);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("calculateRecipeCost — yield validation", () => {
  it("throws InvalidYieldError for zero yield", () => {
    const g = graph({
      target_recipe_id: 1,
      recipes: [recipe({ id: 1, name: "Zero Yield", yield_quantity: 0 })],
    });
    expect(() => calculateRecipeCost(g)).toThrow(InvalidYieldError);
  });

  it("throws InvalidYieldError for negative yield", () => {
    const g = graph({
      target_recipe_id: 1,
      recipes: [recipe({ id: 1, name: "Negative Yield", yield_quantity: -5 })],
    });
    expect(() => calculateRecipeCost(g)).toThrow(InvalidYieldError);
  });
});

describe("calculateRecipeCost — unit errors", () => {
  const flour = rawMaterial({
    id: 1,
    name: "Flour",
    base_unit_code: "g",
    purchase_history: [purchase({ cost_per_base_unit_micros: 2500 })],
  });

  it("throws UnknownUnitError when an ingredient uses an unrecognized unit code", () => {
    const g = graph({
      target_recipe_id: 1,
      recipes: [
        recipe({
          id: 1,
          name: "Bad Unit",
          ingredients: [ingredient({ raw_material_id: 1, quantity: 1, unit_code: "gallon" })],
        }),
      ],
      raw_materials: [flour],
    });
    expect(() => calculateRecipeCost(g)).toThrow(UnknownUnitError);
  });

  it("throws UnknownUnitError when a recipe's yield unit is unrecognized", () => {
    const g = graph({
      target_recipe_id: 1,
      recipes: [recipe({ id: 1, name: "Bad Yield Unit", yield_unit_code: "stone" })],
    });
    expect(() => calculateRecipeCost(g)).toThrow(UnknownUnitError);
  });

  it("throws IncompatibleUnitError converting a weight ingredient into a volume-based raw material", () => {
    const cream = rawMaterial({
      id: 2,
      name: "Cream",
      base_unit_code: "ml",
      purchase_history: [purchase({ cost_per_base_unit_micros: 6667 })],
    });
    const g = graph({
      target_recipe_id: 1,
      recipes: [
        recipe({
          id: 1,
          name: "Bad Kind",
          ingredients: [ingredient({ raw_material_id: 2, quantity: 100, unit_code: "g" })],
        }),
      ],
      raw_materials: [cream],
    });
    expect(() => calculateRecipeCost(g)).toThrow(IncompatibleUnitError);
  });

  it("throws IncompatibleUnitError converting a volume quantity into a weight-yield sub-recipe", () => {
    const ganache = recipe({ id: 10, name: "Ganache", yield_quantity: 800, yield_unit_code: "g" });
    const g = graph({
      target_recipe_id: 1,
      recipes: [
        recipe({
          id: 1,
          name: "Uses Ganache Wrong",
          ingredients: [
            ingredient({
              ingredient_type: "recipe",
              sub_recipe_id: 10,
              quantity: 200,
              unit_code: "ml",
            }),
          ],
        }),
        ganache,
      ],
    });
    expect(() => calculateRecipeCost(g)).toThrow(IncompatibleUnitError);
  });
});

describe("calculateRecipeCost — missing ingredient cost", () => {
  it("throws MissingIngredientCostError when a raw material has no purchase history", () => {
    const flour = rawMaterial({ id: 1, name: "Flour", base_unit_code: "g", purchase_history: [] });
    const g = graph({
      target_recipe_id: 1,
      recipes: [
        recipe({
          id: 1,
          name: "Needs Flour",
          ingredients: [ingredient({ raw_material_id: 1, quantity: 100, unit_code: "g" })],
        }),
      ],
      raw_materials: [flour],
    });
    expect(() => calculateRecipeCost(g)).toThrow(MissingIngredientCostError);
  });
});

describe("calculateRecipeCost — circular dependencies", () => {
  it("throws CircularDependencyError for a direct two-hop cycle (A -> B -> A)", () => {
    const a = recipe({
      id: 1,
      name: "A",
      ingredients: [
        ingredient({ ingredient_type: "recipe", sub_recipe_id: 2, quantity: 1, unit_code: "g" }),
      ],
    });
    const b = recipe({
      id: 2,
      name: "B",
      ingredients: [
        ingredient({ ingredient_type: "recipe", sub_recipe_id: 1, quantity: 1, unit_code: "g" }),
      ],
    });
    const g = graph({ target_recipe_id: 1, recipes: [a, b] });
    expect(() => calculateRecipeCost(g)).toThrow(CircularDependencyError);
  });

  it("throws CircularDependencyError for a three-hop cycle (A -> B -> C -> A)", () => {
    const a = recipe({
      id: 1,
      name: "A",
      ingredients: [
        ingredient({ ingredient_type: "recipe", sub_recipe_id: 2, quantity: 1, unit_code: "g" }),
      ],
    });
    const b = recipe({
      id: 2,
      name: "B",
      ingredients: [
        ingredient({ ingredient_type: "recipe", sub_recipe_id: 3, quantity: 1, unit_code: "g" }),
      ],
    });
    const c = recipe({
      id: 3,
      name: "C",
      ingredients: [
        ingredient({ ingredient_type: "recipe", sub_recipe_id: 1, quantity: 1, unit_code: "g" }),
      ],
    });
    const g = graph({ target_recipe_id: 1, recipes: [a, b, c] });
    try {
      calculateRecipeCost(g);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CircularDependencyError);
      expect((err as Error).message).toContain("A → B → C → A");
    }
  });

  it("throws CircularDependencyError for a direct self-reference", () => {
    const a = recipe({
      id: 1,
      name: "Self",
      ingredients: [
        ingredient({ ingredient_type: "recipe", sub_recipe_id: 1, quantity: 1, unit_code: "g" }),
      ],
    });
    const g = graph({ target_recipe_id: 1, recipes: [a] });
    expect(() => calculateRecipeCost(g)).toThrow(CircularDependencyError);
  });
});

describe("calculateRecipeCost — archived / missing recipe references", () => {
  it("throws ArchivedReferenceError when a sub-recipe ingredient points at an archived recipe", () => {
    const archived = recipe({ id: 2, name: "Old Filling", status: "archived" });
    const parent = recipe({
      id: 1,
      name: "Parent",
      ingredients: [
        ingredient({ ingredient_type: "recipe", sub_recipe_id: 2, quantity: 1, unit_code: "g" }),
      ],
    });
    const g = graph({ target_recipe_id: 1, recipes: [parent, archived] });
    expect(() => calculateRecipeCost(g)).toThrow(ArchivedReferenceError);
  });

  it("allows an archived recipe to be the *target* of the calculation itself", () => {
    const archivedTarget = recipe({ id: 1, name: "Discontinued Cake", status: "archived" });
    const g = graph({ target_recipe_id: 1, recipes: [archivedTarget] });
    expect(() => calculateRecipeCost(g)).not.toThrow();
  });

  it("throws ArchivedReferenceError (data-integrity reuse) when a sub_recipe_id doesn't exist in the graph at all", () => {
    const parent = recipe({
      id: 1,
      name: "Parent",
      ingredients: [
        ingredient({ ingredient_type: "recipe", sub_recipe_id: 999, quantity: 1, unit_code: "g" }),
      ],
    });
    const g = graph({ target_recipe_id: 1, recipes: [parent] });
    expect(() => calculateRecipeCost(g)).toThrow(ArchivedReferenceError);
  });

  it("throws ArchivedReferenceError (data-integrity reuse) when target_recipe_id doesn't exist in the graph", () => {
    const g = graph({ target_recipe_id: 999, recipes: [recipe({ id: 1, name: "Unrelated" })] });
    expect(() => calculateRecipeCost(g)).toThrow(ArchivedReferenceError);
  });
});

describe("calculateRecipeCost — excessive nesting depth", () => {
  function buildChain(length: number): RecipeCostingGraph {
    const recipes: CostingRecipeNode[] = [];
    for (let i = 1; i <= length; i++) {
      const isLast = i === length;
      recipes.push(
        recipe({
          id: i,
          name: `Level ${i}`,
          yield_quantity: 1,
          yield_unit_code: "g",
          ingredients: isLast
            ? []
            : [
                ingredient({
                  ingredient_type: "recipe",
                  sub_recipe_id: i + 1,
                  quantity: 1,
                  unit_code: "g",
                }),
              ],
        }),
      );
    }
    return graph({ target_recipe_id: 1, recipes });
  }

  it("does NOT throw for a chain exactly at the default max depth (10 levels)", () => {
    const g = buildChain(10);
    expect(() => calculateRecipeCost(g)).not.toThrow();
  });

  it("throws ExcessiveNestingError for a chain deeper than the default max depth (11 levels)", () => {
    const g = buildChain(11);
    expect(() => calculateRecipeCost(g)).toThrow(ExcessiveNestingError);
  });

  it("respects a custom maxDepth option", () => {
    const g = buildChain(4);
    expect(() => calculateRecipeCost(g, { maxDepth: 3 })).toThrow(ExcessiveNestingError);
    expect(() => calculateRecipeCost(g, { maxDepth: 4 })).not.toThrow();
  });
});

describe("calculateRecipeCost — empty ingredient list", () => {
  it("treats a recipe with zero ingredients as valid, with zero cost", () => {
    const g = graph({
      target_recipe_id: 1,
      recipes: [
        recipe({
          id: 1,
          name: "Empty",
          yield_quantity: 10,
          yield_unit_code: "piece",
          ingredients: [],
        }),
      ],
    });
    const result = calculateRecipeCost(g);
    expect(result.lines).toEqual([]);
    expect(result.totalCostMicros).toBe(0);
    expect(result.costPerYieldUnitMicros).toBe(0);
    expect(result.pricingStrategyUsed).toEqual([]);
  });
});

describe("calculateRecipeCost — memoization of a sub-recipe used twice", () => {
  it("computes a diamond-shaped sub-recipe reference only once and reuses the identical breakdown object", () => {
    const chocolate = rawMaterial({
      id: 1,
      name: "Chocolate",
      base_unit_code: "g",
      purchase_history: [purchase({ cost_per_base_unit_micros: 10000 })],
    });
    const ganache = recipe({
      id: 10,
      name: "Ganache",
      yield_quantity: 1,
      yield_unit_code: "g",
      ingredients: [ingredient({ raw_material_id: 1, quantity: 1, unit_code: "g" })],
    });
    const filling = recipe({
      id: 11,
      name: "Filling",
      yield_quantity: 1,
      yield_unit_code: "g",
      ingredients: [
        ingredient({ ingredient_type: "recipe", sub_recipe_id: 10, quantity: 100, unit_code: "g" }),
      ],
    });
    const cake = recipe({
      id: 20,
      name: "Cake",
      yield_quantity: 1,
      yield_unit_code: "g",
      ingredients: [
        ingredient({ ingredient_type: "recipe", sub_recipe_id: 10, quantity: 200, unit_code: "g" }), // Ganache direct
        ingredient({ ingredient_type: "recipe", sub_recipe_id: 11, quantity: 1, unit_code: "g" }), // Ganache via Filling
      ],
    });
    const g = graph({
      target_recipe_id: 20,
      recipes: [cake, filling, ganache],
      raw_materials: [chocolate],
    });

    const result = calculateRecipeCost(g);
    const directGanache = result.lines[0]?.subBreakdown;
    const fillingBreakdown = result.lines[1]?.subBreakdown;
    const nestedGanache = fillingBreakdown?.lines[0]?.subBreakdown;

    expect(directGanache).toBeDefined();
    expect(nestedGanache).toBeDefined();
    // Same object reference => computed exactly once and memoized, not recomputed.
    expect(directGanache).toBe(nestedGanache);

    // Correctness: Ganache costPerYieldUnitMicros = 1g x 10000 / 1 = 10000 micros/g.
    // Direct line: 200g x 10000 = 2_000_000. Filling: 100g x 10000 = 1_000_000 (per its own 1g yield).
    // Cake's Filling line: 1g (of Filling) x 1_000_000/g = 1_000_000.
    expect(result.lines[0]?.lineCostMicros).toBe(2_000_000);
    expect(result.lines[1]?.lineCostMicros).toBe(1_000_000);
    expect(result.totalCostMicros).toBe(3_000_000);
  });
});

describe("calculateRecipeCost — monetary rounding correctness", () => {
  it("keeps full precision through the Decimal chain instead of rounding an intermediate average first", () => {
    // average of 10000, 10000, 10001 = 30001/3 = 10000.3333... (repeating decimal)
    const vanilla = rawMaterial({
      id: 1,
      name: "Vanilla",
      base_unit_code: "g",
      pricing_strategy: "average_n",
      pricing_strategy_config: '{"n":3}',
      purchase_history: [
        purchase({ purchase_date: "2026-01-01", cost_per_base_unit_micros: 10000 }),
        purchase({ purchase_date: "2026-02-01", cost_per_base_unit_micros: 10000 }),
        purchase({ purchase_date: "2026-03-01", cost_per_base_unit_micros: 10001 }),
      ],
    });
    const g = graph({
      target_recipe_id: 1,
      recipes: [
        recipe({
          id: 1,
          name: "Uses Vanilla",
          yield_quantity: 1,
          yield_unit_code: "g",
          ingredients: [ingredient({ raw_material_id: 1, quantity: 7, unit_code: "g" })],
        }),
      ],
      raw_materials: [vanilla],
    });

    const result = calculateRecipeCost(g);
    const line = result.lines[0];
    expect(line).toBeDefined();

    // Naive (WRONG) approach: round the average to 10000 first, then multiply by 7 -> 70000.
    // Correct approach: keep 30001/3 at full precision, multiply by 7 (= 210007/3 = 70002.333...),
    // and round only once at the end -> 70002.
    expect(line?.unitCostMicros).toBe(10000);
    expect(line?.lineCostMicros).toBe(70002);
    // Explicitly demonstrate this is NOT simply quantity * (already-rounded) unitCostMicros.
    expect(line?.lineCostMicros).not.toBe((line?.quantity ?? 0) * (line?.unitCostMicros ?? 0));
    expect(result.totalCostMicros).toBe(70002);
  });
});

describe("calculateRecipeCost — pricing strategies end-to-end", () => {
  const latestMaterial = rawMaterial({
    id: 1,
    name: "Latest-Priced",
    base_unit_code: "g",
    pricing_strategy: "latest",
    purchase_history: [
      purchase({
        purchase_date: "2026-01-01",
        cost_per_base_unit_micros: 1000,
        supplier_name: "Old",
      }),
      purchase({
        purchase_date: "2026-06-01",
        cost_per_base_unit_micros: 1500,
        supplier_name: "New",
      }),
    ],
  });
  const averageMaterial = rawMaterial({
    id: 2,
    name: "Average-Priced",
    base_unit_code: "g",
    pricing_strategy: "average_n",
    pricing_strategy_config: '{"n":2}',
    purchase_history: [
      purchase({ purchase_date: "2026-01-01", cost_per_base_unit_micros: 2000 }),
      purchase({ purchase_date: "2026-02-01", cost_per_base_unit_micros: 4000 }),
    ],
  });
  const manualMaterial = rawMaterial({
    id: 3,
    name: "Manual-Priced",
    base_unit_code: "g",
    pricing_strategy: "manual",
    pricing_strategy_config: '{"manual_price_micros":9999}',
    purchase_history: [],
  });

  function makeGraph() {
    return graph({
      target_recipe_id: 1,
      recipes: [
        recipe({
          id: 1,
          name: "Mixed Strategies",
          ingredients: [
            ingredient({ raw_material_id: 1, quantity: 1, unit_code: "g" }),
            ingredient({ raw_material_id: 2, quantity: 1, unit_code: "g" }),
            ingredient({ raw_material_id: 3, quantity: 1, unit_code: "g" }),
          ],
        }),
      ],
      raw_materials: [latestMaterial, averageMaterial, manualMaterial],
    });
  }

  it("resolves 'latest' to the most recent purchase overall", () => {
    const result = calculateRecipeCost(makeGraph());
    expect(result.lines[0]?.lineCostMicros).toBe(1500);
    const entry = result.pricingStrategyUsed.find((p) => p.rawMaterialId === 1);
    expect(entry?.strategy).toBe("latest");
    expect(entry?.sourceDescription).toBe("latest purchase, 2026-06-01, New");
  });

  it("resolves 'average_n' to the mean of the configured N most recent purchases", () => {
    const result = calculateRecipeCost(makeGraph());
    expect(result.lines[1]?.lineCostMicros).toBe(3000); // (2000+4000)/2
    const entry = result.pricingStrategyUsed.find((p) => p.rawMaterialId === 2);
    expect(entry?.strategy).toBe("average_n");
    expect(entry?.sourceDescription).toBe("average of last 2 purchases");
  });

  it("resolves 'manual' to the configured manual price, ignoring purchase history", () => {
    const result = calculateRecipeCost(makeGraph());
    expect(result.lines[2]?.lineCostMicros).toBe(9999);
    const entry = result.pricingStrategyUsed.find((p) => p.rawMaterialId === 3);
    expect(entry?.strategy).toBe("manual");
    expect(entry?.sourceDescription).toBe("manual override price");
  });

  it("resolves 'latest' relative to asOfDate, picking an earlier purchase than the overall latest", () => {
    const result = calculateRecipeCost(makeGraph(), { asOfDate: "2026-03-01" });
    // As of March 1st, the June purchase hasn't happened yet -> falls back to January's price.
    expect(result.lines[0]?.lineCostMicros).toBe(1000);
    const entry = result.pricingStrategyUsed.find((p) => p.rawMaterialId === 1);
    expect(entry?.sourceDescription).toBe("latest purchase, 2026-01-01, Old");
  });
});
