import { useEffect, useState } from "react";
import { calculateRecipeCost } from "@pastry-management/core";
import type { CostBreakdown } from "@pastry-management/core";
import * as recipesApi from "../../api/recipes";
import type { RecipeSummary } from "../../api/types";
import { describeCostingError } from "../../lib/costingErrors";
import { useI18n } from "../../lib/i18n";
import { RecipeCostBreakdown } from "../recipes/RecipeCostBreakdown";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

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
    setCostError(null);
    const id = Number(value);
    if (!Number.isFinite(id)) return;

    setCostLoading(true);
    recipesApi
      .getRecipeCostingGraph(id)
      .then((graph) => {
        setBreakdown(calculateRecipeCost(graph));
      })
      .catch((err) => {
        setCostError(describeCostingError(err, locale));
      })
      .finally(() => setCostLoading(false));
  }

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
          <CardContent>
            <RecipeCostBreakdown breakdown={breakdown} />
          </CardContent>
        </Card>
      )}
    </section>
  );
}
