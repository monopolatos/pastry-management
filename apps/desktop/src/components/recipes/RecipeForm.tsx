import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { UNIT_KIND_LABEL_KEYS } from "../../api/types";
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
import { useI18n } from "../../lib/i18n";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";

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
  const { t } = useI18n();

  function unitKindLabel(kind: string): string {
    const key = UNIT_KIND_LABEL_KEYS[kind];
    return key ? t(key) : kind;
  }

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
            message: t("recipes.fillIngredientRow"),
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
    <form className="flex max-w-2xl flex-col gap-4" onSubmit={handleSubmit}>
      {formError.general && (
        <p className="text-sm font-medium text-destructive">{formError.general}</p>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="recipe-name">{t("common.name")}</Label>
        <Input
          id="recipe-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        {formError.fieldError("name") && (
          <p className="text-sm text-destructive">{formError.fieldError("name")}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="recipe-description">{t("common.description")}</Label>
        <Textarea
          id="recipe-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="recipe-category">{t("common.category")}</Label>
        <Input
          id="recipe-category"
          type="text"
          list="recipe-category-options"
          placeholder={t("recipes.categoryPlaceholder")}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        />
        <datalist id="recipe-category-options">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <p className="text-xs text-muted-foreground">{t("recipes.pickCategoryHint")}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="recipe-instructions">{t("recipes.instructions")}</Label>
        <Textarea
          id="recipe-instructions"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="recipe-prep-time">{t("recipes.prepTimeMinutes")}</Label>
          <Input
            id="recipe-prep-time"
            type="number"
            step="1"
            min="0"
            value={prepTimeMinutes}
            onChange={(e) => setPrepTimeMinutes(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="recipe-cook-time">{t("recipes.cookTimeMinutes")}</Label>
          <Input
            id="recipe-cook-time"
            type="number"
            step="1"
            min="0"
            value={cookTimeMinutes}
            onChange={(e) => setCookTimeMinutes(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="recipe-yield-quantity">{t("recipes.yieldQuantity")}</Label>
          <Input
            id="recipe-yield-quantity"
            type="number"
            step="any"
            min="0"
            value={yieldQuantity}
            onChange={(e) => setYieldQuantity(e.target.value)}
            required
          />
          {formError.fieldError("yield_quantity") && (
            <p className="text-sm text-destructive">{formError.fieldError("yield_quantity")}</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="recipe-yield-unit">{t("recipes.yieldUnit")}</Label>
          <Select value={yieldUnitCode} onValueChange={setYieldUnitCode}>
            <SelectTrigger id="recipe-yield-unit" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {units.map((unit) => (
                <SelectItem key={unit.code} value={unit.code}>
                  {unit.code} ({unitKindLabel(unit.kind)})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {formError.fieldError("yield_unit_code") && (
            <p className="text-sm text-destructive">{formError.fieldError("yield_unit_code")}</p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="recipe-notes">{t("common.notes")}</Label>
        <Textarea id="recipe-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <fieldset className="flex flex-col gap-3 rounded-lg border p-4">
        <legend className="px-1 text-sm font-semibold">{t("recipes.ingredients")}</legend>

        {formError.fieldError("ingredients") && (
          <p className="text-sm text-destructive">{formError.fieldError("ingredients")}</p>
        )}

        {rows.map((row) => (
          <div key={row.key} className="flex flex-col gap-3 rounded-lg border p-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`ingredient-type-${row.key}`}>{t("recipes.type")}</Label>
              <Select
                value={row.ingredient_type}
                onValueChange={(value) => handleTypeChange(row.key, value as IngredientType)}
              >
                <SelectTrigger id={`ingredient-type-${row.key}`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="raw_material">{t("recipes.rawMaterialOption")}</SelectItem>
                  <SelectItem value="recipe">{t("recipes.recipeSubRecipeOption")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {row.ingredient_type === "raw_material" ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`ingredient-material-${row.key}`}>
                  {t("recipes.rawMaterialOption")}
                </Label>
                <Select
                  value={row.raw_material_id}
                  onValueChange={(value) => updateRow(row.key, { raw_material_id: value })}
                >
                  <SelectTrigger id={`ingredient-material-${row.key}`} className="w-full">
                    <SelectValue placeholder={t("recipes.selectMaterialPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {rawMaterials.map((m) => (
                      <SelectItem key={m.id} value={String(m.id)}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`ingredient-recipe-${row.key}`}>{t("recipes.subRecipe")}</Label>
                <Select
                  value={row.sub_recipe_id}
                  onValueChange={(value) => updateRow(row.key, { sub_recipe_id: value })}
                >
                  <SelectTrigger id={`ingredient-recipe-${row.key}`} className="w-full">
                    <SelectValue placeholder={t("recipes.selectRecipePlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {recipeOptions.map((r) => (
                      <SelectItem key={r.id} value={String(r.id)}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`ingredient-quantity-${row.key}`}>{t("common.quantity")}</Label>
                <Input
                  id={`ingredient-quantity-${row.key}`}
                  type="number"
                  step="any"
                  min="0"
                  value={row.quantity}
                  onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`ingredient-unit-${row.key}`}>{t("recipes.unit")}</Label>
                <Select
                  value={row.unit_code}
                  onValueChange={(value) => updateRow(row.key, { unit_code: value })}
                >
                  <SelectTrigger id={`ingredient-unit-${row.key}`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {units.map((unit) => (
                      <SelectItem key={unit.code} value={unit.code}>
                        {unit.code} ({unitKindLabel(unit.kind)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Button type="button" variant="outline" size="sm" onClick={() => removeRow(row.key)}>
                {t("recipes.removeIngredient")}
              </Button>
            </div>
          </div>
        ))}

        <div>
          <Button type="button" variant="outline" onClick={addRow}>
            {t("recipes.addIngredient")}
          </Button>
        </div>
      </fieldset>

      <div className="flex gap-3">
        <Button type="submit" disabled={submitting}>
          {submitting
            ? t("common.saving")
            : initial
              ? t("common.saveChanges")
              : t("recipes.addRecipe")}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
