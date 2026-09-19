import Decimal from "decimal.js";
import { MissingIngredientCostError } from "../costing/errors.js";
import type {
  CostingPurchaseRecord,
  CostingRawMaterial,
  PricingStrategy,
} from "../costing/types.js";

export interface ResolvedRawMaterialPrice {
  strategy: PricingStrategy;
  costPerBaseUnitMicros: Decimal; // full precision — NOT rounded. Round only at the output boundary.
  sourceDescription: string;
}

const DEFAULT_AVERAGE_N = 5;

function sortByDateDesc(records: CostingPurchaseRecord[]): CostingPurchaseRecord[] {
  return [...records].sort((a, b) => {
    if (a.purchase_date < b.purchase_date) return 1;
    if (a.purchase_date > b.purchase_date) return -1;
    return 0;
  });
}

/** Purchases sorted most-recent-first, optionally filtered to on/before asOfDate. */
function eligiblePurchases(
  material: CostingRawMaterial,
  asOfDate: string | undefined,
): CostingPurchaseRecord[] {
  const sorted = sortByDateDesc(material.purchase_history);
  if (asOfDate === undefined) return sorted;
  return sorted.filter((purchase) => purchase.purchase_date <= asOfDate);
}

function noPurchaseDetail(asOfDate: string | undefined): string {
  return asOfDate ? `no purchase on or before ${asOfDate}` : "no purchase history recorded";
}

function parseConfig(configJson: string | null): Record<string, unknown> | null {
  if (!configJson) return null;
  try {
    const parsed: unknown = JSON.parse(configJson);
    if (parsed !== null && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function resolveLatest(
  material: CostingRawMaterial,
  eligible: CostingPurchaseRecord[],
  asOfDate: string | undefined,
): ResolvedRawMaterialPrice {
  const latest = eligible[0];
  if (!latest) {
    throw new MissingIngredientCostError(material.name, noPurchaseDetail(asOfDate));
  }
  const supplierPart = latest.supplier_name
    ? `, ${latest.supplier_name}`
    : " (no supplier recorded)";
  return {
    strategy: "latest",
    costPerBaseUnitMicros: new Decimal(latest.cost_per_base_unit_micros),
    sourceDescription: `latest purchase, ${latest.purchase_date}${supplierPart}`,
  };
}

function resolveAverageN(
  material: CostingRawMaterial,
  eligible: CostingPurchaseRecord[],
  asOfDate: string | undefined,
): ResolvedRawMaterialPrice {
  const config = parseConfig(material.pricing_strategy_config);
  const configuredN = config?.n;
  const n =
    typeof configuredN === "number" && Number.isFinite(configuredN) && configuredN > 0
      ? Math.floor(configuredN)
      : DEFAULT_AVERAGE_N;

  const chosen = eligible.slice(0, n);
  if (chosen.length === 0) {
    throw new MissingIngredientCostError(material.name, noPurchaseDetail(asOfDate));
  }

  const sum = chosen.reduce(
    (acc, purchase) => acc.add(purchase.cost_per_base_unit_micros),
    new Decimal(0),
  );
  const average = sum.div(chosen.length);

  return {
    strategy: "average_n",
    costPerBaseUnitMicros: average,
    sourceDescription: `average of last ${chosen.length} purchase${chosen.length === 1 ? "" : "s"}`,
  };
}

function resolveManual(material: CostingRawMaterial): ResolvedRawMaterialPrice {
  const config = parseConfig(material.pricing_strategy_config);
  const manualPriceMicros = config?.manual_price_micros;
  if (typeof manualPriceMicros !== "number" || !Number.isFinite(manualPriceMicros)) {
    throw new MissingIngredientCostError(
      material.name,
      "manual pricing strategy has no manual_price_micros configured",
    );
  }
  return {
    strategy: "manual",
    costPerBaseUnitMicros: new Decimal(manualPriceMicros),
    sourceDescription: "manual override price",
  };
}

/**
 * Resolve the cost-per-base-unit for a raw material per its pricing strategy,
 * optionally as-of a historical date. Returns full Decimal precision — callers
 * round to whole micros only when constructing final output objects.
 *
 * Throws MissingIngredientCostError when no price can be resolved: empty
 * purchase history, no purchase on/before asOfDate, or (for "manual") a
 * missing/malformed pricing_strategy_config.
 */
export function resolveRawMaterialPrice(
  material: CostingRawMaterial,
  asOfDate?: string,
): ResolvedRawMaterialPrice {
  switch (material.pricing_strategy) {
    case "manual":
      return resolveManual(material);
    case "average_n":
      return resolveAverageN(material, eligiblePurchases(material, asOfDate), asOfDate);
    case "latest":
      return resolveLatest(material, eligiblePurchases(material, asOfDate), asOfDate);
    default: {
      // Exhaustiveness guard: PricingStrategy is a closed union, so this is
      // unreachable given well-typed input — but the engine must not trust
      // its input blindly (see costing-engine.md's InvalidYieldError note).
      const unknownStrategy: string = material.pricing_strategy;
      throw new MissingIngredientCostError(
        material.name,
        `unknown pricing strategy "${unknownStrategy}"`,
      );
    }
  }
}
