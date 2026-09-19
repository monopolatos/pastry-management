# Recipe Costing Engine

Originally a Phase 1 design proposal; **implemented in Phase 4** in `packages/core/src/costing` (with `packages/core/src/units` and `packages/core/src/pricing` as supporting modules), pure TypeScript, no I/O, 54 passing Vitest tests. See §6 for where the implementation's exact interface and a few judgment calls differ from this doc's original sketch.

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

## 6. Implementation Notes (Phase 4)

The shipped interface is data-driven and snake_case, matching the Rust backend's serialized output field-for-field (`RecipeCostingGraph`, `CostingRecipeNode`, `CostingIngredient`, `CostingRawMaterial`, `CostingPurchaseRecord`, `CostingUnit` — see `apps/desktop/src-tauri/src/db/repositories/recipes.rs`) rather than the illustrative camelCase `Map`-based sketch in §1. This was a deliberate simplification made during implementation: the engine builds its own internal lookup maps from the flat arrays Rust naturally produces, so the Tauri command → frontend → engine path needs zero field-mapping glue. `packages/core/src/costing/types.ts` is the authoritative type definition.

Money/percentage fields on the _output_ (`CostBreakdown`, `CostLine`, `PricingStrategyUsedEntry`) are plain `number`s, not `Decimal`, rounded to the nearest whole integer micro exactly once at output construction — all arithmetic leading up to that point uses `decimal.js` at full precision (verified by a dedicated test using a repeating-decimal average). This keeps the public contract trivially JSON-serializable across the Tauri boundary and consistent with how every other part of the app already handles money (plain integer micros).

Judgment calls made where this doc was ambiguous:

- **Empty ingredient list**: the engine treats this as a valid, zero-cost recipe rather than an error. The Rust CRUD layer separately rejects empty ingredient lists at write time (see `docs/database-schema.md`), but the engine itself doesn't assume that's the only path data can reach it through.
- **A `sub_recipe_id` that doesn't exist in the supplied graph at all** (vs. one that exists but is archived) reuses `ArchivedReferenceError` rather than a new error class — both mean "this reference cannot be used as a live ingredient"; the message text distinguishes "does not exist" from "is archived."
- **Cycle detection vs. memoization are separate mechanisms**, not one: a `Set` of recipe ids currently being expanded on the current path (cleared via `finally` on the way back out) catches true cycles, while a separate `Map` of finished breakdowns handles legitimate diamond-shaped reuse (the same sub-recipe used twice at different points in one calculation) without recomputing or false-flagging it as a cycle.
- **Nesting depth** is only counted on a fresh computation; reusing an already-memoized breakdown doesn't re-check depth at the reuse site.
- The worked example in §4 has an internal inconsistency in the original doc text (chocolate/cream/butter cost-per-gram figures given in €, not micros, so the "€0.0067/g" cream figure doesn't reduce to a round total) — the actual test fixture in `packages/core/src/costing/engine.test.ts` uses exact `cost_per_base_unit_micros` integers chosen so the Chocolate Cake total reproduces the doc's own stated **€5.05 total / €0.505 per piece exactly** (`totalCostMicros: 5_050_000`, `costPerYieldUnitMicros: 505_000`), which is the number that actually matters for the acceptance criterion in `docs/roadmap.md`.
