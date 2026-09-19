import { useCallback, useEffect, useState } from "react";
import {
  ArchivedReferenceError,
  CircularDependencyError,
  ExcessiveNestingError,
  IncompatibleUnitError,
  InvalidYieldError,
  MissingIngredientCostError,
  UnknownUnitError,
  calculateRecipeCost,
} from "@pastry-management/core";
import type { CostBreakdown, RecipeCostingGraph } from "@pastry-management/core";
import { toAppError } from "../../api/errors";
import * as recipesApi from "../../api/recipes";
import type { CostSnapshotSummary, RecipeDetail as RecipeDetailData } from "../../api/types";
import { RecipeCostBreakdown } from "./RecipeCostBreakdown";

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
 * Translates the costing engine's 7 typed error classes (see packages/core/src/costing/errors.ts)
 * into their already-descriptive `.message` (e.g. CircularDependencyError names the exact cycle
 * path), and falls back to the app's usual `{ message, field }` rejection shape for errors thrown
 * by the `get_recipe_costing_graph` Tauri call itself.
 */
function describeCostingError(err: unknown): string {
  if (
    err instanceof CircularDependencyError ||
    err instanceof MissingIngredientCostError ||
    err instanceof ArchivedReferenceError ||
    err instanceof ExcessiveNestingError ||
    err instanceof InvalidYieldError ||
    err instanceof IncompatibleUnitError ||
    err instanceof UnknownUnitError
  ) {
    return err.message;
  }
  return toAppError(err).message;
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
  const [graph, setGraph] = useState<RecipeCostingGraph | null>(null);
  const [breakdown, setBreakdown] = useState<CostBreakdown | null>(null);
  const [costLoading, setCostLoading] = useState(true);
  const [costError, setCostError] = useState<string | null>(null);

  const [snapshots, setSnapshots] = useState<CostSnapshotSummary[]>([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(true);
  const [snapshotsError, setSnapshotsError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const calculateCost = useCallback(() => {
    setCostLoading(true);
    setCostError(null);
    setSaveSuccess(false);
    recipesApi
      .getRecipeCostingGraph(recipe.id)
      .then((fetchedGraph) => {
        setGraph(fetchedGraph);
        setBreakdown(calculateRecipeCost(fetchedGraph));
      })
      .catch((err) => {
        setCostError(describeCostingError(err));
        setGraph(null);
        setBreakdown(null);
      })
      .finally(() => setCostLoading(false));
  }, [recipe.id]);

  const refreshSnapshots = useCallback(() => {
    setSnapshotsLoading(true);
    setSnapshotsError(null);
    recipesApi
      .listRecipeCostSnapshots(recipe.id)
      .then(setSnapshots)
      .catch((err) => setSnapshotsError(toAppError(err).message))
      .finally(() => setSnapshotsLoading(false));
  }, [recipe.id]);

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
    setSaveSuccess(false);
    try {
      await recipesApi.saveRecipeCostSnapshot(
        recipe.id,
        JSON.stringify(breakdown.pricingStrategyUsed),
        breakdown.totalCostMicros,
        breakdown.costPerYieldUnitMicros,
        JSON.stringify(breakdown),
      );
      setSaveSuccess(true);
      refreshSnapshots();
    } catch (err) {
      setSaveError(toAppError(err).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <button type="button" onClick={onBack}>
        ← Back to recipes
      </button>

      <h2>{recipe.name}</h2>

      <dl className="detail-summary">
        <dt>Category</dt>
        <dd>{recipe.category ?? "—"}</dd>
        <dt>Status</dt>
        <dd>
          <span className={recipe.status === "active" ? "badge-active" : "badge-inactive"}>
            {recipe.status === "active" ? "Active" : "Archived"}
          </span>
        </dd>
        <dt>Yield</dt>
        <dd>
          {recipe.yield_quantity} {recipe.yield_unit_code}
        </dd>
        <dt>Prep time</dt>
        <dd>{recipe.prep_time_minutes != null ? `${recipe.prep_time_minutes} min` : "—"}</dd>
        <dt>Cook time</dt>
        <dd>{recipe.cook_time_minutes != null ? `${recipe.cook_time_minutes} min` : "—"}</dd>
      </dl>

      {recipe.description && (
        <>
          <h3>Description</h3>
          <p>{recipe.description}</p>
        </>
      )}

      {recipe.instructions && (
        <>
          <h3>Instructions</h3>
          <p className="pre-wrap">{recipe.instructions}</p>
        </>
      )}

      {recipe.notes && (
        <>
          <h3>Notes</h3>
          <p>{recipe.notes}</p>
        </>
      )}

      <h3>Ingredients</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Quantity</th>
            <th>Unit</th>
          </tr>
        </thead>
        <tbody>
          {recipe.ingredients.map((ing) => (
            <tr key={ing.id}>
              <td>{ing.ingredient_name}</td>
              <td>{ing.quantity}</td>
              <td>{ing.unit_code}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Cost Breakdown</h3>
      <div className="form-actions">
        <button type="button" onClick={calculateCost} disabled={costLoading}>
          {costLoading ? "Calculating…" : "Recalculate cost"}
        </button>
      </div>

      {costLoading && <p>Calculating cost…</p>}
      {costError && <p className="form-error">{costError}</p>}

      {!costLoading && !costError && breakdown && (
        <>
          <RecipeCostBreakdown breakdown={breakdown} />

          <h4>Prices used</h4>
          <ul>
            {breakdown.pricingStrategyUsed.map((entry) => (
              <li key={entry.rawMaterialId}>
                {entry.rawMaterialName}: €{formatMoney(entry.costPerBaseUnitMicros, 4)}/
                {rawMaterialBaseUnit(entry.rawMaterialId)} ({entry.sourceDescription})
              </li>
            ))}
          </ul>

          <p className="hint">Calculated at {formatDateTime(breakdown.calculatedAt)}</p>

          <div className="form-actions">
            <button type="button" onClick={handleSaveCost} disabled={saving}>
              {saving ? "Saving…" : "Save this cost"}
            </button>
          </div>
          {saveError && <p className="form-error">{saveError}</p>}
          {saveSuccess && <p className="form-info">Cost snapshot saved.</p>}
        </>
      )}

      <h3>Cost History</h3>
      {snapshotsLoading ? (
        <p>Loading…</p>
      ) : snapshotsError ? (
        <p className="form-error">{snapshotsError}</p>
      ) : snapshots.length === 0 ? (
        <p>No cost snapshots saved yet.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Total cost</th>
              <th>Cost per yield unit</th>
            </tr>
          </thead>
          <tbody>
            {snapshots.map((snap) => (
              <tr key={snap.id}>
                <td>{formatDateTime(snap.calculated_at)}</td>
                <td>€{formatMoney(snap.total_cost_micros)}</td>
                <td>€{formatMoney(snap.cost_per_yield_unit_micros, 4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
