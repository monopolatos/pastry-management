# Recipe Costing Engine (Phase 1 Design)

Lives entirely in `packages/core/costing` — pure TypeScript, no I/O, fully unit-testable in isolation from the database/UI.

## 1. Inputs / Outputs

```ts
interface CostingInput {
  targetRecipeId: RecipeId;
  recipes: Map<RecipeId, RecipeVersion>; // pre-loaded, already resolved to current versions
  rawMaterials: Map<RawMaterialId, RawMaterialWithResolvedCost>; // cost already resolved per pricing strategy
  asOfDate?: ISODate; // for historical costing; defaults to "now"
}

interface CostBreakdown {
  recipeId: RecipeId;
  calculatedAt: ISODateTime;
  totalCostMicros: Decimal;
  yieldQuantity: Decimal;
  yieldUnit: UnitCode;
  costPerYieldUnitMicros: Decimal;
  lines: CostLine[]; // one per ingredient, includes nested sub-recipe expansion
  pricingStrategyUsed: PricingStrategySummary;
}

interface CostLine {
  ingredientType: "raw_material" | "recipe";
  ingredientId: RawMaterialId | RecipeId;
  name: string;
  quantity: Decimal;
  unit: UnitCode;
  unitCostMicros: Decimal; // cost per one unit of `unit`, after conversion to base unit
  lineCostMicros: Decimal;
  percentOfTotal: Decimal;
  subBreakdown?: CostBreakdown; // present when ingredientType === 'recipe' (recursive)
}
```

## 2. Algorithm

1. **Cycle & integrity check first.** Walk the ingredient graph from `targetRecipeId`. Reject with a typed error (`CircularDependencyError`, naming the cycle path) if any recipe reappears in its own ancestry. Reject with `MissingIngredientCostError` if a raw material has no resolvable purchase price, and `ArchivedReferenceError` if a sub-recipe is archived (archived recipes can still be _viewed_ historically but cannot be used as a live ingredient in new calculations). Enforce a configurable max depth (default 10) → `ExcessiveNestingError`.
2. **Depth-first recursive evaluation**, memoized per `(recipeId, asOfDate)` within a single calculation run so a sub-recipe used twice (e.g. ganache used both directly and inside a filling) is only computed once.
3. For each ingredient line:
   - `raw_material`: convert `quantity`/`unit` to the raw material's base unit (weight↔weight or volume↔volume only — **never** weight↔volume without an explicit, user-configured density conversion, per requirement §7). `lineCostMicros = quantityInBaseUnit × costPerBaseUnitMicros`.
   - `recipe`: recursively compute the sub-recipe's `CostBreakdown`, take its `costPerYieldUnitMicros`, convert the parent's requested quantity into the sub-recipe's yield unit (must be unit-compatible — reject with `IncompatibleUnitError` otherwise), multiply.
4. Sum all `lineCostMicros` → `totalCostMicros`. `costPerYieldUnitMicros = totalCostMicros / yieldQuantity` (reject yield ≤ 0 up front — `InvalidYieldError`).
5. All arithmetic uses `decimal.js` (`Decimal` type, 28+ significant digits); conversion to/from stored INTEGER micros happens only at the DB read/write boundary.

## 3. Pricing Strategy Resolution (default behavior)

Documented per requirement §8 — the user must always be able to see _which_ price was used.

- **Default: `latest`** — the most recent `purchase_records` row for that raw material (across all suppliers, ordered by `purchase_date DESC, id DESC`) is used.
- **`average_n`** — arithmetic mean of the last N purchases' `cost_per_base_unit_micros` (N configurable per material, default 5).
- **`manual`** — a fixed price set directly on the raw material, overriding purchase history (useful for planning/what-if costing).
- **Historical costing**: passing `asOfDate` resolves "latest as of that date" instead of "latest overall," enabling "what would this recipe have cost in January" queries against `purchase_records`.
- Every `CostBreakdown` embeds `pricingStrategyUsed`, naming the strategy and the exact purchase record(s)/date used per raw material, so the UI can show "Flour: €0.0025/g (latest purchase, 2026-09-10, Supplier X)" next to the line item.
- **Costs are recalculated on demand, not trusted from storage.** `recipe_cost_snapshots` exist purely as an audit trail (e.g., "what did we quote this cake at in March"); the displayed "current cost" in the UI is always a fresh calculation. A snapshot is written whenever a user explicitly views/exports a cost breakdown or when a scheduled recalculation runs, never silently relied upon as current truth.

## 4. Nested Recipe Example (validated against requirement §11/§12)

```
Ganache: chocolate 500g + cream 300ml + butter 50g → yield 800g
  totalCost = 500×€0.010 + 300×€0.0067 + 50×€0.020 = €5.00+€2.00+€1.00(illustrative) = €8.00
  costPerGram = €8.00 / 800g = €0.01/g

Chocolate Cake: flour 500g + sugar 300g + eggs 4pc + ganache 200g → yield 10 pieces
  ganache line = 200g × €0.01/g = €2.00
  totalCost = €1.25 + €0.60 + €1.20 + €2.00 = €5.05
  costPerPiece = €5.05 / 10 = €0.505
```

matches requirement §12.4's worked example exactly.

## 5. Edge Cases Covered by Design (and by the Test Engineer's suite)

Zero/negative yield, missing yield, unknown/incompatible units, missing ingredient cost, circular references (direct and multi-level), self-reference, archived sub-recipe reference, deleted sub-recipe reference, excessive nesting depth, empty ingredient list, duplicate sub-recipe used at multiple levels (memoization correctness), monetary rounding at display boundaries (round-half-even at the final display step only, never mid-calculation).
