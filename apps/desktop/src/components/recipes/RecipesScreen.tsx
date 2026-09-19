import { useCallback, useEffect, useState } from "react";
import { toAppError } from "../../api/errors";
import { listMeasurementUnits } from "../../api/measurementUnits";
import { listRawMaterials } from "../../api/rawMaterials";
import * as recipesApi from "../../api/recipes";
import type {
  MeasurementUnit,
  RawMaterial,
  RecipeDetail as RecipeDetailData,
  RecipeInput,
  RecipeSummary,
} from "../../api/types";
import { RecipeDetail } from "./RecipeDetail";
import { RecipeForm } from "./RecipeForm";

type Panel = { mode: "closed" } | { mode: "create" } | { mode: "edit"; recipe: RecipeDetailData };

function unitLabel(units: MeasurementUnit[], code: string): string {
  const unit = units.find((u) => u.code === code);
  return unit ? `${unit.code} (${unit.kind})` : code;
}

export function RecipesScreen() {
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  // Always active-only, regardless of the "show archived" toggle below — used to populate the
  // sub-recipe picker in the ingredient builder, which must never offer an archived recipe (the
  // backend rejects that anyway; see recipes.rs validate_ingredient).
  const [activeRecipes, setActiveRecipes] = useState<RecipeSummary[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
  const [units, setUnits] = useState<MeasurementUnit[]>([]);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>({ mode: "closed" });
  const [rowError, setRowError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [selectedRecipe, setSelectedRecipe] = useState<RecipeDetailData | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    Promise.all([
      recipesApi.listRecipes(includeArchived),
      recipesApi.listRecipes(false),
      listRawMaterials(false),
      listMeasurementUnits(),
    ])
      .then(([recipesResult, activeResult, materialsResult, unitsResult]) => {
        setRecipes(recipesResult);
        setActiveRecipes(activeResult);
        setRawMaterials(materialsResult);
        setUnits(unitsResult);
      })
      .catch((err) => setLoadError(toAppError(err).message))
      .finally(() => setLoading(false));
  }, [includeArchived]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleCreate(input: RecipeInput) {
    await recipesApi.createRecipe(input);
    setPanel({ mode: "closed" });
    refresh();
  }

  async function handleUpdate(id: number, input: RecipeInput) {
    await recipesApi.updateRecipe(id, input);
    setPanel({ mode: "closed" });
    refresh();
  }

  async function openEdit(id: number) {
    setRowError(null);
    try {
      const detail = await recipesApi.getRecipe(id);
      setPanel({ mode: "edit", recipe: detail });
    } catch (err) {
      setRowError(toAppError(err).message);
    }
  }

  async function openDetail(id: number) {
    setRowError(null);
    try {
      const detail = await recipesApi.getRecipe(id);
      setSelectedRecipe(detail);
    } catch (err) {
      setRowError(toAppError(err).message);
    }
  }

  async function handleArchiveToggle(recipe: RecipeSummary) {
    setRowError(null);
    try {
      if (recipe.status === "active") {
        await recipesApi.archiveRecipe(recipe.id);
      } else {
        await recipesApi.reactivateRecipe(recipe.id);
      }
      refresh();
    } catch (err) {
      setRowError(toAppError(err).message);
    }
  }

  async function handleDuplicate(id: number) {
    setRowError(null);
    try {
      await recipesApi.duplicateRecipe(id, null);
      refresh();
    } catch (err) {
      setRowError(toAppError(err).message);
    }
  }

  async function handleDelete(id: number) {
    setRowError(null);
    try {
      await recipesApi.deleteRecipe(id);
      setConfirmDeleteId(null);
      refresh();
    } catch (err) {
      setRowError(toAppError(err).message);
      setConfirmDeleteId(null);
    }
  }

  if (selectedRecipe) {
    return (
      <RecipeDetail
        recipe={selectedRecipe}
        onBack={() => {
          setSelectedRecipe(null);
          refresh();
        }}
      />
    );
  }

  const categories = Array.from(
    new Set(recipes.map((r) => r.category).filter((c): c is string => !!c)),
  ).sort((a, b) => a.localeCompare(b));

  return (
    <section>
      <div className="screen-header">
        <h2>Recipes</h2>
        <div className="screen-header-actions">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
            />
            Show archived
          </label>
          <button type="button" onClick={() => setPanel({ mode: "create" })}>
            Add recipe
          </button>
        </div>
      </div>

      {rowError && <p className="form-error">{rowError}</p>}
      {loadError && <p className="form-error">{loadError}</p>}

      {panel.mode === "create" && (
        <div className="panel">
          <h3>Add recipe</h3>
          <RecipeForm
            categories={categories}
            rawMaterials={rawMaterials}
            recipeOptions={activeRecipes}
            units={units}
            onSubmit={handleCreate}
            onCancel={() => setPanel({ mode: "closed" })}
          />
        </div>
      )}

      {panel.mode === "edit" && (
        <div className="panel">
          <h3>Edit recipe</h3>
          <RecipeForm
            initial={panel.recipe}
            categories={categories}
            rawMaterials={rawMaterials}
            recipeOptions={activeRecipes.filter((r) => r.id !== panel.recipe.id)}
            units={units}
            onSubmit={(input) => handleUpdate(panel.recipe.id, input)}
            onCancel={() => setPanel({ mode: "closed" })}
          />
        </div>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : recipes.length === 0 ? (
        <p>No recipes yet.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Category</th>
              <th>Yield</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {recipes.map((recipe) => (
              <tr key={recipe.id}>
                <td>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => openDetail(recipe.id)}
                  >
                    {recipe.name}
                  </button>
                </td>
                <td>{recipe.category ?? "—"}</td>
                <td>
                  {recipe.yield_quantity} {unitLabel(units, recipe.yield_unit_code)}
                </td>
                <td>
                  <span className={recipe.status === "active" ? "badge-active" : "badge-inactive"}>
                    {recipe.status === "active" ? "Active" : "Archived"}
                  </span>
                </td>
                <td className="row-actions">
                  <button type="button" onClick={() => openEdit(recipe.id)}>
                    Edit
                  </button>
                  <button type="button" onClick={() => handleArchiveToggle(recipe)}>
                    {recipe.status === "active" ? "Archive" : "Reactivate"}
                  </button>
                  <button type="button" onClick={() => handleDuplicate(recipe.id)}>
                    Duplicate
                  </button>
                  {confirmDeleteId === recipe.id ? (
                    <>
                      <span>Delete permanently?</span>
                      <button type="button" onClick={() => handleDelete(recipe.id)}>
                        Confirm
                      </button>
                      <button type="button" onClick={() => setConfirmDeleteId(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button type="button" onClick={() => setConfirmDeleteId(recipe.id)}>
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
