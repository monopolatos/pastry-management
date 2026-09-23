import { useEffect, useMemo, useState } from "react";
import { buildUnitsByCode, calculateRecipeCost, convertQuantity } from "@pastry-management/core";
import type { CostBreakdown, CostingUnit } from "@pastry-management/core";
import * as recipesApi from "../../api/recipes";
import type { RecipeSummary } from "../../api/types";
import { describeCostingError } from "../../lib/costingErrors";
import { useI18n } from "../../lib/i18n";
import { RecipeCostBreakdown } from "../recipes/RecipeCostBreakdown";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

function formatMoney(micros: number, digits = 2): string {
  return (micros / 1_000_000).toFixed(digits);
}

/**
 * A fast-access view onto the exact same calculation Recipes' detail screen already does — not a
 * second calculation engine. Picking a recipe fetches its costing graph and runs
 * `calculateRecipeCost` (from @pastry-management/core) client-side, then renders the result with
 * the same `RecipeCostBreakdown` component the Recipes screen uses.
 */
export function CostCalculatorScreen() {
  const { t, te, locale } = useI18n();
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [recipesLoading, setRecipesLoading] = useState(true);
  const [recipesError, setRecipesError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string>("");
  const [breakdown, setBreakdown] = useState<CostBreakdown | null>(null);
  const [units, setUnits] = useState<CostingUnit[]>([]);
  const [gramsPerPortion, setGramsPerPortion] = useState<number | null>(null);
  const [costLoading, setCostLoading] = useState(false);
  const [costError, setCostError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    recipesApi
      .listRecipes(false)
      .then((result) => {
        if (!cancelled) setRecipes(result);
      })
      .catch((err) => {
        if (!cancelled) setRecipesError(te(err));
      })
      .finally(() => {
        if (!cancelled) setRecipesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [te]);

  function handleSelect(value: string) {
    setSelectedId(value);
    setBreakdown(null);
    setUnits([]);
    setGramsPerPortion(null);
    setCostError(null);
    const id = Number(value);
    if (!Number.isFinite(id)) return;

    setCostLoading(true);
    Promise.all([recipesApi.getRecipeCostingGraph(id), recipesApi.getRecipe(id)])
      .then(([graph, detail]) => {
        setBreakdown(calculateRecipeCost(graph));
        setUnits(graph.units);
        setGramsPerPortion(detail.grams_per_portion);
      })
      .catch((err) => {
        setCostError(describeCostingError(err, locale));
      })
      .finally(() => setCostLoading(false));
  }

  // Servings (and cost/serving) only make sense for a weight-yield recipe with grams_per_portion
  // set — same rule RecipeForm's editor and RecipeDetail's read-only view use.
  const servings = useMemo(() => {
    if (!breakdown || gramsPerPortion == null || gramsPerPortion <= 0 || units.length === 0) {
      return null;
    }
    const yieldUnitKind = units.find((u) => u.code === breakdown.yieldUnit)?.kind;
    if (yieldUnitKind !== "weight") return null;
    try {
      const unitsByCode = buildUnitsByCode(units);
      const totalGrams = convertQuantity(
        breakdown.yieldQuantity,
        breakdown.yieldUnit,
        "g",
        unitsByCode,
      ).toNumber();
      return totalGrams / gramsPerPortion;
    } catch {
      return null;
    }
  }, [breakdown, units, gramsPerPortion]);

  const costPerServingMicros =
    servings != null && servings > 0 && breakdown != null
      ? breakdown.totalCostMicros / servings
      : null;

  return (
    <section className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("costCalculator.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{t("costCalculator.description")}</p>

          {recipesError && <p className="text-sm font-medium text-destructive">{recipesError}</p>}

          <div className="flex max-w-sm flex-col gap-1.5">
            <Select value={selectedId} onValueChange={handleSelect} disabled={recipesLoading}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("costCalculator.selectPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {recipes.map((recipe) => (
                  <SelectItem key={recipe.id} value={String(recipe.id)}>
                    {recipe.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!recipesLoading && recipes.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("costCalculator.noRecipes")}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {costLoading && (
        <p className="text-sm text-muted-foreground">{t("costCalculator.calculating")}</p>
      )}
      {costError && <p className="text-sm font-medium text-destructive">{costError}</p>}

      {!costLoading && !costError && !breakdown && (
        <p className="text-sm text-muted-foreground">{t("costCalculator.empty")}</p>
      )}

      {!costLoading && !costError && breakdown && (
        <Card>
          <CardContent className="flex flex-col gap-3">
            <RecipeCostBreakdown breakdown={breakdown} />

            {servings != null && costPerServingMicros != null && (
              <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="font-medium text-muted-foreground">
                  {t("recipes.numberOfPortions")}
                </dt>
                <dd>{servings.toFixed(1)}</dd>
                <dt className="font-medium text-muted-foreground">{t("recipes.costPerPortion")}</dt>
                <dd className="font-semibold">€{formatMoney(costPerServingMicros)}</dd>
              </dl>
            )}
          </CardContent>
        </Card>
      )}
    </section>
  );
}
