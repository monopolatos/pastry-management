import { useRef, useState } from "react";
import type { FormEvent } from "react";
import type {
  IngredientType,
  MeasurementUnit,
  RawMaterial,
  RecipeDetail,
  RecipeIngredientInput,
  RecipeInput,
  RecipeSummary,
} from "../../api/types";
import { useFormError } from "../../hooks/useFormError";

interface RecipeFormProps {
  initial?: RecipeDetail;
  /** Existing category values across all recipes, offered as a picker (see `<datalist>` below) so
   * categories stay consistent without needing a separate categories table/CRUD screen. */
  categories: string[];
  /** Active raw materials only — an archived material can't be picked for a new/edited recipe. */
  rawMaterials: RawMaterial[];
  /** Active recipes only, excluding the recipe currently being edited (if any) — picking itself
   * would be an obviously-doomed self-reference the backend rejects anyway. */
  recipeOptions: RecipeSummary[];
  units: MeasurementUnit[];
  onSubmit: (input: RecipeInput) => Promise<void>;
  onCancel: () => void;
}

interface IngredientRow {
  key: number;
  ingredient_type: IngredientType;
  raw_material_id: string;
  sub_recipe_id: string;
  quantity: string;
  unit_code: string;
}

const KNOWN_FIELDS = ["name", "yield_quantity", "yield_unit_code", "ingredients"] as const;

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function emptyToNullMinutes(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function RecipeForm({
  initial,
  categories,
  rawMaterials,
  recipeOptions,
  units,
  onSubmit,
  onCancel,
}: RecipeFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [instructions, setInstructions] = useState(initial?.instructions ?? "");
  const [prepTimeMinutes, setPrepTimeMinutes] = useState(
    initial?.prep_time_minutes != null ? String(initial.prep_time_minutes) : "",
  );
  const [cookTimeMinutes, setCookTimeMinutes] = useState(
    initial?.cook_time_minutes != null ? String(initial.cook_time_minutes) : "",
  );
  const [yieldQuantity, setYieldQuantity] = useState(
    initial?.yield_quantity != null ? String(initial.yield_quantity) : "",
  );
  const [yieldUnitCode, setYieldUnitCode] = useState(
    initial?.yield_unit_code ?? units[0]?.code ?? "",
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const nextKey = useRef(0);
  function newRowKey(): number {
    nextKey.current += 1;
    return nextKey.current;
  }

  function makeEmptyRow(): IngredientRow {
    return {
      key: newRowKey(),
      ingredient_type: "raw_material",
      raw_material_id: rawMaterials[0] ? String(rawMaterials[0].id) : "",
      sub_recipe_id: recipeOptions[0] ? String(recipeOptions[0].id) : "",
      quantity: "",
      unit_code: units[0]?.code ?? "",
    };
  }

  const [rows, setRows] = useState<IngredientRow[]>(() =>
    initial && initial.ingredients.length > 0
      ? initial.ingredients.map((ing) => ({
          key: newRowKey(),
          ingredient_type: ing.ingredient_type,
          raw_material_id: ing.raw_material_id != null ? String(ing.raw_material_id) : "",
          sub_recipe_id: ing.sub_recipe_id != null ? String(ing.sub_recipe_id) : "",
          quantity: String(ing.quantity),
          unit_code: ing.unit_code,
        }))
      : [makeEmptyRow()],
  );

  const [submitting, setSubmitting] = useState(false);
  const formError = useFormError();

  function updateRow(key: number, patch: Partial<IngredientRow>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function handleTypeChange(key: number, ingredientType: IngredientType) {
    updateRow(key, {
      ingredient_type: ingredientType,
      raw_material_id:
        ingredientType === "raw_material"
          ? rawMaterials[0]
            ? String(rawMaterials[0].id)
            : ""
          : "",
      sub_recipe_id:
        ingredientType === "recipe" ? (recipeOptions[0] ? String(recipeOptions[0].id) : "") : "",
    });
  }

  function addRow() {
    setRows((current) => [...current, makeEmptyRow()]);
  }

  function removeRow(key: number) {
    setRows((current) => current.filter((row) => row.key !== key));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    formError.clear();

    if (name.trim() === "") {
      formError.handle({ message: "Recipe name is required.", field: "name" }, ["name"]);
      return;
    }

    const yieldQuantityNumber = parseFloat(yieldQuantity);
    if (!Number.isFinite(yieldQuantityNumber) || yieldQuantityNumber <= 0) {
      formError.handle({ message: "Yield must be greater than zero.", field: "yield_quantity" }, [
        "yield_quantity",
      ]);
      return;
    }

    if (rows.length === 0) {
      formError.handle(
        { message: "A recipe needs at least one ingredient.", field: "ingredients" },
        ["ingredients"],
      );
      return;
    }

    const ingredients: RecipeIngredientInput[] = [];
    for (const row of rows) {
      const quantityNumber = parseFloat(row.quantity);
      const hasSelection =
        row.ingredient_type === "raw_material"
          ? row.raw_material_id !== ""
          : row.sub_recipe_id !== "";
      if (
        !hasSelection ||
        !Number.isFinite(quantityNumber) ||
        quantityNumber <= 0 ||
        row.unit_code === ""
      ) {
        formError.handle(
          {
            message:
              "Fill in a material or recipe, a quantity greater than zero, and a unit for every ingredient row.",
            field: "ingredients",
          },
          ["ingredients"],
        );
        return;
      }
      ingredients.push({
        ingredient_type: row.ingredient_type,
        raw_material_id:
          row.ingredient_type === "raw_material" ? Number(row.raw_material_id) : null,
        sub_recipe_id: row.ingredient_type === "recipe" ? Number(row.sub_recipe_id) : null,
        quantity: quantityNumber,
        unit_code: row.unit_code,
      });
    }

    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        description: emptyToNull(description),
        category: emptyToNull(category),
        instructions: emptyToNull(instructions),
        prep_time_minutes: emptyToNullMinutes(prepTimeMinutes),
        cook_time_minutes: emptyToNullMinutes(cookTimeMinutes),
        notes: emptyToNull(notes),
        yield_quantity: yieldQuantityNumber,
        yield_unit_code: yieldUnitCode,
        ingredients,
      });
    } catch (err) {
      formError.handle(err, KNOWN_FIELDS);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="stacked-form" onSubmit={handleSubmit}>
      {formError.general && <p className="form-error">{formError.general}</p>}

      <label htmlFor="recipe-name">Name</label>
      <input
        id="recipe-name"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      {formError.fieldError("name") && (
        <p className="field-error">{formError.fieldError("name")}</p>
      )}

      <label htmlFor="recipe-description">Description</label>
      <textarea
        id="recipe-description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      <label htmlFor="recipe-category">Category</label>
      <input
        id="recipe-category"
        type="text"
        list="recipe-category-options"
        placeholder="e.g. Cakes, Pastries, Fillings…"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
      />
      <datalist id="recipe-category-options">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <p className="hint">Pick an existing category or type a new one.</p>

      <label htmlFor="recipe-instructions">Instructions</label>
      <textarea
        id="recipe-instructions"
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
      />

      <label htmlFor="recipe-prep-time">Prep time (minutes)</label>
      <input
        id="recipe-prep-time"
        type="number"
        step="1"
        min="0"
        value={prepTimeMinutes}
        onChange={(e) => setPrepTimeMinutes(e.target.value)}
      />

      <label htmlFor="recipe-cook-time">Cook time (minutes)</label>
      <input
        id="recipe-cook-time"
        type="number"
        step="1"
        min="0"
        value={cookTimeMinutes}
        onChange={(e) => setCookTimeMinutes(e.target.value)}
      />

      <label htmlFor="recipe-yield-quantity">Yield quantity</label>
      <input
        id="recipe-yield-quantity"
        type="number"
        step="any"
        min="0"
        value={yieldQuantity}
        onChange={(e) => setYieldQuantity(e.target.value)}
        required
      />
      {formError.fieldError("yield_quantity") && (
        <p className="field-error">{formError.fieldError("yield_quantity")}</p>
      )}

      <label htmlFor="recipe-yield-unit">Yield unit</label>
      <select
        id="recipe-yield-unit"
        value={yieldUnitCode}
        onChange={(e) => setYieldUnitCode(e.target.value)}
      >
        {units.map((unit) => (
          <option key={unit.code} value={unit.code}>
            {unit.code} ({unit.kind})
          </option>
        ))}
      </select>
      {formError.fieldError("yield_unit_code") && (
        <p className="field-error">{formError.fieldError("yield_unit_code")}</p>
      )}

      <label htmlFor="recipe-notes">Notes</label>
      <textarea id="recipe-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />

      <fieldset className="inline-fieldset">
        <legend>Ingredients</legend>

        {formError.fieldError("ingredients") && (
          <p className="field-error">{formError.fieldError("ingredients")}</p>
        )}

        {rows.map((row) => (
          <div className="inline-fieldset" key={row.key}>
            <label htmlFor={`ingredient-type-${row.key}`}>Type</label>
            <select
              id={`ingredient-type-${row.key}`}
              value={row.ingredient_type}
              onChange={(e) => handleTypeChange(row.key, e.target.value as IngredientType)}
            >
              <option value="raw_material">Raw material</option>
              <option value="recipe">Recipe (sub-recipe)</option>
            </select>

            {row.ingredient_type === "raw_material" ? (
              <>
                <label htmlFor={`ingredient-material-${row.key}`}>Raw material</label>
                <select
                  id={`ingredient-material-${row.key}`}
                  value={row.raw_material_id}
                  onChange={(e) => updateRow(row.key, { raw_material_id: e.target.value })}
                >
                  <option value="">(select a material)</option>
                  {rawMaterials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <>
                <label htmlFor={`ingredient-recipe-${row.key}`}>Sub-recipe</label>
                <select
                  id={`ingredient-recipe-${row.key}`}
                  value={row.sub_recipe_id}
                  onChange={(e) => updateRow(row.key, { sub_recipe_id: e.target.value })}
                >
                  <option value="">(select a recipe)</option>
                  {recipeOptions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </>
            )}

            <label htmlFor={`ingredient-quantity-${row.key}`}>Quantity</label>
            <input
              id={`ingredient-quantity-${row.key}`}
              type="number"
              step="any"
              min="0"
              value={row.quantity}
              onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
            />

            <label htmlFor={`ingredient-unit-${row.key}`}>Unit</label>
            <select
              id={`ingredient-unit-${row.key}`}
              value={row.unit_code}
              onChange={(e) => updateRow(row.key, { unit_code: e.target.value })}
            >
              {units.map((unit) => (
                <option key={unit.code} value={unit.code}>
                  {unit.code} ({unit.kind})
                </option>
              ))}
            </select>

            <div className="form-actions">
              <button type="button" onClick={() => removeRow(row.key)}>
                Remove ingredient
              </button>
            </div>
          </div>
        ))}

        <div className="form-actions">
          <button type="button" onClick={addRow}>
            Add ingredient
          </button>
        </div>
      </fieldset>

      <div className="form-actions">
        <button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : initial ? "Save changes" : "Add recipe"}
        </button>
        <button type="button" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
      </div>
    </form>
  );
}
