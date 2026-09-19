import Decimal from "decimal.js";
import { resolveRawMaterialPrice } from "../pricing/resolve.js";
import { buildUnitsByCode, convertQuantity } from "../units/convert.js";
import {
  ArchivedReferenceError,
  CircularDependencyError,
  ExcessiveNestingError,
  InvalidYieldError,
  MissingIngredientCostError,
  UnknownUnitError,
} from "./errors.js";
import type {
  CalculateCostOptions,
  CostBreakdown,
  CostLine,
  CostingRawMaterial,
  CostingRecipeNode,
  PricingStrategyUsedEntry,
  RecipeCostingGraph,
} from "./types.js";

const DEFAULT_MAX_DEPTH = 10;

/** Round a full-precision Decimal to the nearest whole integer micro, as a plain number. */
function toMicros(value: Decimal): number {
  return value.toDecimalPlaces(0).toNumber();
}

/** A computed line before rounding is applied — kept at full Decimal precision until output construction. */
interface PendingLine {
  ingredientType: "raw_material" | "recipe";
  ingredientId: number;
  name: string;
  quantity: number;
  unit: string;
  unitCostExact: Decimal;
  lineCostExact: Decimal;
  subBreakdown: CostBreakdown | undefined;
}

/**
 * Recursively compute a full cost breakdown for `graph.target_recipe_id`.
 *
 * See docs/costing-engine.md for the full design. Summary of the notable
 * judgment calls made in this implementation:
 *
 * - A recipe with zero ingredients is treated as a valid, zero-cost recipe
 *   (not an error) — the Rust CRUD layer already rejects empty ingredient
 *   lists at write time, but this engine must behave sensibly on any input
 *   it's handed rather than assume that validation is the only gate.
 * - A sub_recipe_id (or the top-level target_recipe_id) that doesn't resolve
 *   to any node in graph.recipes at all is treated as a data-integrity error
 *   and reported via ArchivedReferenceError (reusing that error type rather
 *   than inventing a new one, since both cases mean "this reference cannot
 *   be used" — the message text distinguishes "archived" from "not found").
 * - Memoization key is recipeId alone (asOfDate is fixed for the whole
 *   top-level call, so it's equivalent to keying on the pair). A sub-recipe
 *   reused via a memoized result is not re-checked against maxDepth at its
 *   point of reuse — only fresh computations count towards nesting depth —
 *   since memoization and depth-limiting are deliberately separate concerns
 *   from cycle detection (see costing-engine.md §2 step 3-4).
 */
export function calculateRecipeCost(
  graph: RecipeCostingGraph,
  options: CalculateCostOptions = {},
): CostBreakdown {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const asOfDate = options.asOfDate;

  const recipesById = new Map<number, CostingRecipeNode>(graph.recipes.map((r) => [r.id, r]));
  const rawMaterialsById = new Map<number, CostingRawMaterial>(
    graph.raw_materials.map((m) => [m.id, m]),
  );
  const unitsByCode = buildUnitsByCode(graph.units);

  // Memoization: finished breakdowns, reused as-is when the same recipe is
  // referenced more than once within this single top-level call (a "diamond").
  const memo = new Map<number, CostBreakdown>();
  // Cycle detection: recipe ids on the current root-to-here call stack. This
  // is a *different* state than memoization — a memoized/finished result
  // being reused from two branches is fine; a recipe reappearing while it is
  // still being expanded (present in `inProgress`) is a genuine cycle.
  const inProgress = new Set<number>();
  const pathNames: string[] = [];

  function computeRecipe(recipeId: number, depth: number): CostBreakdown {
    const memoized = memo.get(recipeId);
    if (memoized) return memoized;

    if (depth > maxDepth) {
      throw new ExcessiveNestingError(maxDepth);
    }

    const node = recipesById.get(recipeId);
    if (!node) {
      throw new ArchivedReferenceError(
        `Sub-recipe id ${recipeId} is referenced as an ingredient but does not exist in the costing graph (data integrity error).`,
      );
    }

    if (inProgress.has(recipeId)) {
      throw new CircularDependencyError([...pathNames, node.name].join(" → "));
    }

    if (node.yield_quantity <= 0) {
      throw new InvalidYieldError(node.name, node.yield_quantity);
    }

    if (!unitsByCode.has(node.yield_unit_code)) {
      throw new UnknownUnitError(node.yield_unit_code);
    }

    inProgress.add(recipeId);
    pathNames.push(node.name);

    try {
      const pricingUsed = new Map<number, PricingStrategyUsedEntry>();
      const pending: PendingLine[] = [];
      let totalCostExact = new Decimal(0);

      for (const ingredient of node.ingredients) {
        if (ingredient.ingredient_type === "raw_material") {
          const materialId = ingredient.raw_material_id;
          if (materialId === null) {
            throw new Error(
              `Ingredient of type "raw_material" on recipe "${node.name}" is missing raw_material_id (data integrity error).`,
            );
          }
          const material = rawMaterialsById.get(materialId);
          if (!material) {
            throw new MissingIngredientCostError(
              `raw material id ${materialId}`,
              "referenced by recipe but not present in the costing graph",
            );
          }

          const resolved = resolveRawMaterialPrice(material, asOfDate);
          pricingUsed.set(material.id, {
            rawMaterialId: material.id,
            rawMaterialName: material.name,
            strategy: resolved.strategy,
            costPerBaseUnitMicros: toMicros(resolved.costPerBaseUnitMicros),
            sourceDescription: resolved.sourceDescription,
          });

          const qtyInBase = convertQuantity(
            ingredient.quantity,
            ingredient.unit_code,
            material.base_unit_code,
            unitsByCode,
          );
          const oneUnitInBase = convertQuantity(
            1,
            ingredient.unit_code,
            material.base_unit_code,
            unitsByCode,
          );
          const lineCostExact = qtyInBase.mul(resolved.costPerBaseUnitMicros);
          const unitCostExact = oneUnitInBase.mul(resolved.costPerBaseUnitMicros);

          totalCostExact = totalCostExact.add(lineCostExact);
          pending.push({
            ingredientType: "raw_material",
            ingredientId: material.id,
            name: material.name,
            quantity: ingredient.quantity,
            unit: ingredient.unit_code,
            unitCostExact,
            lineCostExact,
            subBreakdown: undefined,
          });
        } else {
          const subRecipeId = ingredient.sub_recipe_id;
          if (subRecipeId === null) {
            throw new Error(
              `Ingredient of type "recipe" on recipe "${node.name}" is missing sub_recipe_id (data integrity error).`,
            );
          }
          const subNode = recipesById.get(subRecipeId);
          if (!subNode) {
            throw new ArchivedReferenceError(
              `Sub-recipe id ${subRecipeId} is referenced as an ingredient but does not exist in the costing graph (data integrity error).`,
            );
          }
          if (subNode.status === "archived") {
            throw new ArchivedReferenceError(
              `Recipe "${subNode.name}" is archived and cannot be used as a live ingredient in another recipe.`,
            );
          }

          const subBreakdown = computeRecipe(subRecipeId, depth + 1);
          for (const entry of subBreakdown.pricingStrategyUsed) {
            pricingUsed.set(entry.rawMaterialId, entry);
          }

          const qtyInYieldUnit = convertQuantity(
            ingredient.quantity,
            ingredient.unit_code,
            subNode.yield_unit_code,
            unitsByCode,
          );
          const oneUnitInYieldUnit = convertQuantity(
            1,
            ingredient.unit_code,
            subNode.yield_unit_code,
            unitsByCode,
          );
          const lineCostExact = qtyInYieldUnit.mul(subBreakdown.costPerYieldUnitMicros);
          const unitCostExact = oneUnitInYieldUnit.mul(subBreakdown.costPerYieldUnitMicros);

          totalCostExact = totalCostExact.add(lineCostExact);
          pending.push({
            ingredientType: "recipe",
            ingredientId: subNode.id,
            name: subNode.name,
            quantity: ingredient.quantity,
            unit: ingredient.unit_code,
            unitCostExact,
            lineCostExact,
            subBreakdown,
          });
        }
      }

      const lines: CostLine[] = pending.map((p) => ({
        ingredientType: p.ingredientType,
        ingredientId: p.ingredientId,
        name: p.name,
        quantity: p.quantity,
        unit: p.unit,
        unitCostMicros: toMicros(p.unitCostExact),
        lineCostMicros: toMicros(p.lineCostExact),
        percentOfTotal: totalCostExact.isZero()
          ? 0
          : p.lineCostExact.div(totalCostExact).mul(100).toNumber(),
        ...(p.subBreakdown ? { subBreakdown: p.subBreakdown } : {}),
      }));

      const costPerYieldUnitExact = totalCostExact.div(node.yield_quantity);

      const breakdown: CostBreakdown = {
        recipeId: node.id,
        recipeName: node.name,
        calculatedAt: new Date().toISOString(),
        totalCostMicros: toMicros(totalCostExact),
        yieldQuantity: node.yield_quantity,
        yieldUnit: node.yield_unit_code,
        costPerYieldUnitMicros: toMicros(costPerYieldUnitExact),
        lines,
        pricingStrategyUsed: [...pricingUsed.values()],
      };

      memo.set(recipeId, breakdown);
      return breakdown;
    } finally {
      inProgress.delete(recipeId);
      pathNames.pop();
    }
  }

  if (!recipesById.has(graph.target_recipe_id)) {
    throw new ArchivedReferenceError(
      `Target recipe id ${graph.target_recipe_id} does not exist in the costing graph (data integrity error).`,
    );
  }

  return computeRecipe(graph.target_recipe_id, 1);
}
