import { useCallback, useEffect, useState } from "react";
import { calculateRecipeCost } from "@pastry-management/core";
import type { CostBreakdown, RecipeCostingGraph } from "@pastry-management/core";
import { toast } from "sonner";
import * as recipesApi from "../../api/recipes";
import type { CostSnapshotSummary, RecipeDetail as RecipeDetailData } from "../../api/types";
import { describeCostingError } from "../../lib/costingErrors";
import { translateErrorMessage } from "../../lib/errorTranslations";
import { useI18n } from "../../lib/i18n";
import { RecipeCostBreakdown } from "./RecipeCostBreakdown";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { ArrowLeft } from "lucide-react";

interface RecipeDetailProps {
  recipe: RecipeDetailData;
  onBack: () => void;
}

function formatMoney(micros: number, digits = 2): string {
  return (micros / 1_000_000).toFixed(digits);
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/**
 * Cost calculation is entirely client-side: `get_recipe_costing_graph` fetches the raw data, then
 * `calculateRecipeCost` (from @pastry-management/core) does the actual math synchronously in the
 * browser — no Rust involvement beyond assembling the graph.
 *
 * The cost is calculated automatically on mount (with a loading state, since fetching the graph is
 * an async round-trip) rather than requiring an explicit first click, since a recipe's cost is the
 * single most useful piece of information on this page. A "Recalculate cost" button is still
 * offered for refreshing after e.g. a purchase price changes elsewhere.
 */
export function RecipeDetail({ recipe, onBack }: RecipeDetailProps) {
  const { t, te, locale } = useI18n();
  const [graph, setGraph] = useState<RecipeCostingGraph | null>(null);
  const [breakdown, setBreakdown] = useState<CostBreakdown | null>(null);
  const [costLoading, setCostLoading] = useState(true);
  const [costError, setCostError] = useState<string | null>(null);

  const [snapshots, setSnapshots] = useState<CostSnapshotSummary[]>([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(true);
  const [snapshotsError, setSnapshotsError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const calculateCost = useCallback(() => {
    setCostLoading(true);
    setCostError(null);
    recipesApi
      .getRecipeCostingGraph(recipe.id)
      .then((fetchedGraph) => {
        setGraph(fetchedGraph);
        setBreakdown(calculateRecipeCost(fetchedGraph));
      })
      .catch((err) => {
        setCostError(describeCostingError(err, locale));
        setGraph(null);
        setBreakdown(null);
      })
      .finally(() => setCostLoading(false));
  }, [recipe.id, locale]);

  const refreshSnapshots = useCallback(() => {
    setSnapshotsLoading(true);
    setSnapshotsError(null);
    recipesApi
      .listRecipeCostSnapshots(recipe.id)
      .then(setSnapshots)
      .catch((err) => setSnapshotsError(te(err)))
      .finally(() => setSnapshotsLoading(false));
  }, [recipe.id, te]);

  useEffect(() => {
    calculateCost();
  }, [calculateCost]);

  useEffect(() => {
    refreshSnapshots();
  }, [refreshSnapshots]);

  function rawMaterialBaseUnit(rawMaterialId: number): string {
    return graph?.raw_materials.find((rm) => rm.id === rawMaterialId)?.base_unit_code ?? "";
  }

  async function handleSaveCost() {
    if (!breakdown) return;
    setSaving(true);
    setSaveError(null);
    try {
      await recipesApi.saveRecipeCostSnapshot(
        recipe.id,
        JSON.stringify(breakdown.pricingStrategyUsed),
        breakdown.totalCostMicros,
        breakdown.costPerYieldUnitMicros,
        JSON.stringify(breakdown),
      );
      toast.success(t("recipes.costSnapshotSaved"));
      refreshSnapshots();
    } catch (err) {
      setSaveError(te(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <div>
        <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={onBack}>
          <ArrowLeft className="size-4" />
          {t("recipes.backToList")}
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <h2 className="font-heading text-xl font-semibold">{recipe.name}</h2>
        <Badge variant={recipe.status === "active" ? "success" : "destructive"}>
          {recipe.status === "active" ? t("common.active") : t("common.archived")}
        </Badge>
      </div>

      <Card>
        <CardContent>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="font-medium text-muted-foreground">{t("common.category")}</dt>
            <dd>{recipe.category ?? "—"}</dd>
            <dt className="font-medium text-muted-foreground">{t("recipes.yield")}</dt>
            <dd>
              {recipe.yield_quantity} {recipe.yield_unit_code}
            </dd>
            <dt className="font-medium text-muted-foreground">{t("recipes.prepTime")}</dt>
            <dd>
              {recipe.prep_time_minutes != null
                ? t("recipes.minutesValue").replace("{n}", String(recipe.prep_time_minutes))
                : "—"}
            </dd>
            <dt className="font-medium text-muted-foreground">{t("recipes.cookTime")}</dt>
            <dd>
              {recipe.cook_time_minutes != null
                ? t("recipes.minutesValue").replace("{n}", String(recipe.cook_time_minutes))
                : "—"}
            </dd>
          </dl>

          {recipe.description && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold">{t("common.description")}</h3>
              <p className="text-sm text-muted-foreground">{recipe.description}</p>
            </div>
          )}

          {recipe.instructions && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold">{t("recipes.instructions")}</h3>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {recipe.instructions}
              </p>
            </div>
          )}

          {recipe.notes && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold">{t("common.notes")}</h3>
              <p className="text-sm text-muted-foreground">{recipe.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2">
        <h3 className="font-heading text-base font-semibold">{t("recipes.ingredients")}</h3>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.name")}</TableHead>
                <TableHead>{t("common.quantity")}</TableHead>
                <TableHead>{t("recipes.unit")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recipe.ingredients.map((ing) => (
                <TableRow key={ing.id}>
                  <TableCell>{ing.ingredient_name}</TableCell>
                  <TableCell>{ing.quantity}</TableCell>
                  <TableCell>{ing.unit_code}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <h3 className="font-heading text-base font-semibold">{t("recipes.costBreakdown")}</h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={calculateCost}
            disabled={costLoading}
          >
            {costLoading ? t("costCalculator.calculating") : t("recipes.recalculateCost")}
          </Button>
        </div>

        {costLoading && (
          <p className="text-sm text-muted-foreground">{t("recipes.calculatingCostEllipsis")}</p>
        )}
        {costError && <p className="text-sm font-medium text-destructive">{costError}</p>}

        {!costLoading && !costError && breakdown && (
          <>
            <RecipeCostBreakdown breakdown={breakdown} />

            <div>
              <h4 className="text-sm font-semibold">{t("recipes.pricesUsed")}</h4>
              <ul className="mt-1 flex flex-col gap-0.5 text-sm text-muted-foreground">
                {breakdown.pricingStrategyUsed.map((entry) => (
                  <li key={entry.rawMaterialId}>
                    {entry.rawMaterialName}: €{formatMoney(entry.costPerBaseUnitMicros, 4)}/
                    {rawMaterialBaseUnit(entry.rawMaterialId)} (
                    {translateErrorMessage(entry.sourceDescription, locale)})
                  </li>
                ))}
              </ul>
            </div>

            <p className="text-xs text-muted-foreground">
              {t("recipes.calculatedAt").replace(
                "{datetime}",
                formatDateTime(breakdown.calculatedAt),
              )}
            </p>

            <div>
              <Button type="button" onClick={handleSaveCost} disabled={saving}>
                {saving ? t("common.saving") : t("recipes.saveThisCost")}
              </Button>
            </div>
            {saveError && <p className="text-sm font-medium text-destructive">{saveError}</p>}
          </>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="font-heading text-base font-semibold">{t("recipes.costHistory")}</h3>
        {snapshotsLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : snapshotsError ? (
          <p className="text-sm font-medium text-destructive">{snapshotsError}</p>
        ) : snapshots.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("recipes.noCostSnapshots")}</p>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("common.date")}</TableHead>
                  <TableHead>{t("recipes.totalCost")}</TableHead>
                  <TableHead>{t("recipes.costPerYieldUnit")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshots.map((snap) => (
                  <TableRow key={snap.id}>
                    <TableCell>{formatDateTime(snap.calculated_at)}</TableCell>
                    <TableCell>€{formatMoney(snap.total_cost_micros)}</TableCell>
                    <TableCell>€{formatMoney(snap.cost_per_yield_unit_micros, 4)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </section>
  );
}
