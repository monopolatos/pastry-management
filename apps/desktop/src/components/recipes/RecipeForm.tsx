import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  buildUnitsByCode,
  calculateRecipeCost,
  convertQuantity,
  resolveRawMaterialPrice,
} from "@pastry-management/core";
import type { CostBreakdown, CostingRawMaterial, CostingUnit } from "@pastry-management/core";
import * as recipesApi from "../../api/recipes";
import { UNIT_KIND_LABEL_KEYS } from "../../api/types";
import type {
  Category,
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
  /** Active recipe categories — managed from the dedicated Categories screen, not created inline
   * here. */
  categories: Category[];
  /** Active raw materials only — an archived material can't be picked for a new/edited recipe. */
  rawMaterials: RawMaterial[];
  /** Purchase history + pricing strategy for every active raw material, used to compute a live
   * cost preview client-side while the recipe is still being edited (mirrors the read-only
   * RecipeDetail screen's cost breakdown, but without needing the recipe saved first). */
  rawMaterialCosting: CostingRawMaterial[];
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
  /** Denormalized at the moment the row was added/loaded — avoids re-deriving a display name for
   * rows that reference an archived material/recipe no longer present in the active-only props. */
  display_name: string;
}

const KNOWN_FIELDS = [
  "name",
  "category_id",
  "yield_quantity",
  "yield_unit_code",
  "grams_per_portion",
  "ingredients",
] as const;

const NONE_VALUE = "__none__";

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

function formatMoney(micros: number, digits = 2): string {
  return (micros / 1_000_000).toFixed(digits);
}

export function RecipeForm({
  initial,
  categories,
  rawMaterials,
  rawMaterialCosting,
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
  const [categoryId, setCategoryId] = useState(
    initial?.category_id != null ? String(initial.category_id) : "",
  );
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
  const [gramsPerPortion, setGramsPerPortion] = useState(
    initial?.grams_per_portion != null ? String(initial.grams_per_portion) : "",
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const nextKey = useRef(0);
  function newRowKey(): number {
    nextKey.current += 1;
    return nextKey.current;
  }

  const [rows, setRows] = useState<IngredientRow[]>(() =>
    initial
      ? initial.ingredients.map((ing) => ({
          key: newRowKey(),
          ingredient_type: ing.ingredient_type,
          raw_material_id: ing.raw_material_id != null ? String(ing.raw_material_id) : "",
          sub_recipe_id: ing.sub_recipe_id != null ? String(ing.sub_recipe_id) : "",
          quantity: String(ing.quantity),
          unit_code: ing.unit_code,
          display_name: ing.ingredient_name,
        }))
      : [],
  );

  const [pickerSearch, setPickerSearch] = useState("");
  const [subRecipePickerOpen, setSubRecipePickerOpen] = useState(false);
  const [subRecipePick, setSubRecipePick] = useState(
    recipeOptions[0] ? String(recipeOptions[0].id) : "",
  );
  const [subRecipeCostCache, setSubRecipeCostCache] = useState<Record<number, CostBreakdown>>({});

  const [submitting, setSubmitting] = useState(false);
  const formError = useFormError();

  // `MeasurementUnit.kind` is a loosely-typed `string` (fetched live from the backend), while
  // `CostingUnit.kind` is the closed `UnitKind` union — structurally identical at runtime, the
  // cast below just bridges that typing gap.
  const unitsByCode = useMemo(() => buildUnitsByCode(units as unknown as CostingUnit[]), [units]);
  const rawMaterialCostingById = useMemo(
    () => new Map(rawMaterialCosting.map((m) => [m.id, m])),
    [rawMaterialCosting],
  );
  const yieldUnitKind = useMemo(
    () => units.find((u) => u.code === yieldUnitCode)?.kind,
    [units, yieldUnitCode],
  );
  const yieldIsWeight = yieldUnitKind === "weight";

  const filteredMaterials = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    const list =
      q === "" ? rawMaterials : rawMaterials.filter((m) => m.name.toLowerCase().includes(q));
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [rawMaterials, pickerSearch]);

  // Fetch (and cache) each distinct sub-recipe ingredient's own current cost breakdown, so its
  // line cost/unit can be resolved the same way a raw material's is — entirely client-side once
  // loaded, no per-keystroke round trip.
  useEffect(() => {
    const neededIds = Array.from(
      new Set(
        rows
          .filter((r) => r.ingredient_type === "recipe" && r.sub_recipe_id !== "")
          .map((r) => Number(r.sub_recipe_id)),
      ),
    );
    const missing = neededIds.filter((id) => !(id in subRecipeCostCache));
    if (missing.length === 0) return;

    let cancelled = false;
    Promise.all(
      missing.map(async (id) => {
        try {
          const graph = await recipesApi.getRecipeCostingGraph(id);
          return [id, calculateRecipeCost(graph)] as const;
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      setSubRecipeCostCache((current) => {
        const next = { ...current };
        for (const entry of results) {
          if (entry) next[entry[0]] = entry[1];
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [rows, subRecipeCostCache]);

  function updateRow(key: number, patch: Partial<IngredientRow>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function removeRow(key: number) {
    setRows((current) => current.filter((row) => row.key !== key));
  }

  function handlePickMaterial(material: RawMaterial) {
    const alreadyPresent = rows.some(
      (r) => r.ingredient_type === "raw_material" && r.raw_material_id === String(material.id),
    );
    if (alreadyPresent) return;
    setRows((current) => [
      ...current,
      {
        key: newRowKey(),
        ingredient_type: "raw_material",
        raw_material_id: String(material.id),
        sub_recipe_id: "",
        quantity: "",
        unit_code: material.base_unit_code,
        display_name: material.name,
      },
    ]);
  }

  function handleAddSubRecipeRow() {
    const recipe = recipeOptions.find((r) => String(r.id) === subRecipePick);
    if (!recipe) return;
    const alreadyPresent = rows.some(
      (r) => r.ingredient_type === "recipe" && r.sub_recipe_id === String(recipe.id),
    );
    if (alreadyPresent) return;
    setRows((current) => [
      ...current,
      {
        key: newRowKey(),
        ingredient_type: "recipe",
        raw_material_id: "",
        sub_recipe_id: String(recipe.id),
        quantity: "",
        unit_code: recipe.yield_unit_code,
        display_name: recipe.name,
      },
    ]);
    setSubRecipePickerOpen(false);
  }

  // Each row's weight expressed in grams — null for rows with no valid quantity or a non-weight
  // unit. Baker's-percentage math (the % column and the total-weight rescale button below) is a
  // weight-only concept, same as the rest of this app's deliberate no-cross-kind-conversion rule.
  const weightGramsByRow = useMemo(() => {
    return rows.map((row) => {
      const qty = parseFloat(row.quantity);
      if (!Number.isFinite(qty) || qty <= 0) return null;
      const kind = units.find((u) => u.code === row.unit_code)?.kind;
      if (kind !== "weight") return null;
      try {
        return convertQuantity(qty, row.unit_code, "g", unitsByCode).toNumber();
      } catch {
        return null;
      }
    });
  }, [rows, units, unitsByCode]);

  const totalWeightGrams = useMemo(
    () => weightGramsByRow.reduce((sum: number, g) => sum + (g ?? 0), 0),
    [weightGramsByRow],
  );

  const lineCostsMicros = useMemo(() => {
    return rows.map((row) => {
      const qty = parseFloat(row.quantity);
      if (!Number.isFinite(qty) || qty <= 0) return null;
      if (row.ingredient_type === "raw_material") {
        const material = row.raw_material_id
          ? rawMaterialCostingById.get(Number(row.raw_material_id))
          : undefined;
        if (!material) return null;
        try {
          const resolved = resolveRawMaterialPrice(material);
          const qtyInBase = convertQuantity(
            qty,
            row.unit_code,
            material.base_unit_code,
            unitsByCode,
          );
          return Math.round(resolved.costPerBaseUnitMicros.mul(qtyInBase).toNumber());
        } catch {
          return null;
        }
      }
      const breakdown = row.sub_recipe_id
        ? subRecipeCostCache[Number(row.sub_recipe_id)]
        : undefined;
      if (!breakdown) return null;
      try {
        const qtyInYieldUnit = convertQuantity(
          qty,
          row.unit_code,
          breakdown.yieldUnit,
          unitsByCode,
        );
        return Math.round(breakdown.costPerYieldUnitMicros * qtyInYieldUnit.toNumber());
      } catch {
        return null;
      }
    });
  }, [rows, rawMaterialCostingById, subRecipeCostCache, unitsByCode]);

  const totalCostMicros = useMemo(
    () => lineCostsMicros.reduce((sum: number, c) => sum + (c ?? 0), 0),
    [lineCostsMicros],
  );
  const hasIncompleteCost = useMemo(
    () => lineCostsMicros.some((c, i) => c === null && parseFloat(rows[i]?.quantity ?? "") > 0),
    [lineCostsMicros, rows],
  );

  const yieldQuantityNumber = parseFloat(yieldQuantity);
  const costPerYieldUnitMicros =
    Number.isFinite(yieldQuantityNumber) && yieldQuantityNumber > 0
      ? totalCostMicros / yieldQuantityNumber
      : null;

  const gramsPerPortionNumber = parseFloat(gramsPerPortion);
  const portions =
    yieldIsWeight &&
    Number.isFinite(yieldQuantityNumber) &&
    yieldQuantityNumber > 0 &&
    Number.isFinite(gramsPerPortionNumber) &&
    gramsPerPortionNumber > 0
      ? (() => {
          try {
            return (
              convertQuantity(yieldQuantityNumber, yieldUnitCode, "g", unitsByCode).toNumber() /
              gramsPerPortionNumber
            );
          } catch {
            return null;
          }
        })()
      : null;
  const costPerPortionMicros = portions && portions > 0 ? totalCostMicros / portions : null;

  function handleRescaleToTotal() {
    if (!yieldIsWeight || totalWeightGrams <= 0) return;
    if (!Number.isFinite(yieldQuantityNumber) || yieldQuantityNumber <= 0) return;
    let targetGrams: number;
    try {
      targetGrams = convertQuantity(
        yieldQuantityNumber,
        yieldUnitCode,
        "g",
        unitsByCode,
      ).toNumber();
    } catch {
      return;
    }
    const factor = targetGrams / totalWeightGrams;
    setRows((current) =>
      current.map((row, i) => {
        if (weightGramsByRow[i] == null) return row;
        const qty = parseFloat(row.quantity);
        if (!Number.isFinite(qty)) return row;
        return { ...row, quantity: String(Math.round(qty * factor * 100) / 100) };
      }),
    );
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    formError.clear();

    if (name.trim() === "") {
      formError.handle({ message: "Recipe name is required.", field: "name" }, ["name"]);
      return;
    }

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

    const gramsPerPortionValue =
      gramsPerPortion.trim() === ""
        ? null
        : Number.isFinite(gramsPerPortionNumber)
          ? gramsPerPortionNumber
          : null;

    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        description: emptyToNull(description),
        category_id: categoryId === "" ? null : Number(categoryId),
        instructions: emptyToNull(instructions),
        prep_time_minutes: emptyToNullMinutes(prepTimeMinutes),
        cook_time_minutes: emptyToNullMinutes(cookTimeMinutes),
        notes: emptyToNull(notes),
        yield_quantity: yieldQuantityNumber,
        yield_unit_code: yieldUnitCode,
        grams_per_portion: gramsPerPortionValue,
        ingredients,
      });
    } catch (err) {
      formError.handle(err, KNOWN_FIELDS);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={handleSubmit}>
      {formError.general && (
        <p className="text-sm font-medium text-destructive">{formError.general}</p>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        {/* Left column: recipe details */}
        <div className="flex flex-col gap-4">
          <h3 className="font-heading text-sm font-semibold text-muted-foreground">
            {t("recipes.recipeDetails")}
          </h3>

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
            <Label htmlFor="recipe-category">{t("common.category")}</Label>
            <Select
              value={categoryId === "" ? NONE_VALUE : categoryId}
              onValueChange={(value) => setCategoryId(value === NONE_VALUE ? "" : value)}
            >
              <SelectTrigger id="recipe-category" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>{t("common.none")}</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {formError.fieldError("category_id") && (
              <p className="text-sm text-destructive">{formError.fieldError("category_id")}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="recipe-yield-quantity">
                {yieldIsWeight ? t("recipes.totalWeight") : t("recipes.yieldQuantity")}
              </Label>
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
                <p className="text-sm text-destructive">
                  {formError.fieldError("yield_unit_code")}
                </p>
              )}
            </div>
          </div>

          {yieldIsWeight && (
            <>
              <div className="flex items-center justify-between gap-3 -mt-2">
                <p className="text-xs text-muted-foreground">
                  {t("recipes.ingredientsWeight")}: {totalWeightGrams.toFixed(0)} g
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleRescaleToTotal}
                  disabled={totalWeightGrams <= 0}
                >
                  {t("recipes.rescaleToTotal")}
                </Button>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="recipe-grams-per-portion">
                  {t("recipes.gramsPerPortionOptional")}
                </Label>
                <Input
                  id="recipe-grams-per-portion"
                  type="number"
                  step="any"
                  min="0"
                  value={gramsPerPortion}
                  onChange={(e) => setGramsPerPortion(e.target.value)}
                />
                {formError.fieldError("grams_per_portion") && (
                  <p className="text-sm text-destructive">
                    {formError.fieldError("grams_per_portion")}
                  </p>
                )}
              </div>
            </>
          )}

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

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="recipe-description">{t("common.description")}</Label>
            <Textarea
              id="recipe-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="recipe-instructions">{t("recipes.instructions")}</Label>
            <Textarea
              id="recipe-instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="recipe-notes">{t("common.notes")}</Label>
            <Textarea id="recipe-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        {/* Right column: ingredient picker, table, live results */}
        <div className="flex flex-col gap-3">
          <h3 className="font-heading text-sm font-semibold text-muted-foreground">
            {t("recipes.ingredients")}
          </h3>

          {formError.fieldError("ingredients") && (
            <p className="text-sm text-destructive">{formError.fieldError("ingredients")}</p>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[220px_minmax(0,1fr)]">
            <div className="flex flex-col gap-2 rounded-lg border p-3">
              <Label htmlFor="ingredient-picker-search" className="text-xs text-muted-foreground">
                {t("recipes.pickIngredient")}
              </Label>
              <Input
                id="ingredient-picker-search"
                type="text"
                placeholder={t("recipes.searchMaterialsPlaceholder")}
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
              />
              <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
                {filteredMaterials.length === 0 ? (
                  <p className="px-1 py-2 text-xs text-muted-foreground">
                    {t("recipes.noMaterialsFound")}
                  </p>
                ) : (
                  filteredMaterials.map((m) => {
                    const added = rows.some(
                      (r) =>
                        r.ingredient_type === "raw_material" && r.raw_material_id === String(m.id),
                    );
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => handlePickMaterial(m)}
                        disabled={added}
                        className="rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent disabled:cursor-default disabled:text-muted-foreground disabled:hover:bg-transparent"
                      >
                        {m.name}
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            <div className="flex flex-col gap-3">
              {rows.length === 0 ? (
                <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  {t("recipes.pickIngredientHint")}
                </p>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                        <th className="px-3 py-2 font-medium">{t("common.name")}</th>
                        <th className="px-3 py-2 font-medium">{t("recipes.weight")}</th>
                        <th className="px-3 py-2 font-medium">{t("recipes.unit")}</th>
                        <th className="px-3 py-2 font-medium">{t("recipes.percentOfTotal")}</th>
                        <th className="px-3 py-2 font-medium">{t("recipes.cost")}</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, i) => {
                        const percent =
                          weightGramsByRow[i] != null && totalWeightGrams > 0
                            ? (weightGramsByRow[i]! / totalWeightGrams) * 100
                            : null;
                        const lineCost = lineCostsMicros[i];
                        return (
                          <tr key={row.key} className="border-b last:border-b-0">
                            <td className="px-3 py-2">{row.display_name}</td>
                            <td className="px-3 py-2">
                              <Input
                                type="number"
                                step="any"
                                min="0"
                                className="h-8 w-24"
                                value={row.quantity}
                                onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <Select
                                value={row.unit_code}
                                onValueChange={(value) => updateRow(row.key, { unit_code: value })}
                              >
                                <SelectTrigger className="h-8 w-24">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {units.map((unit) => (
                                    <SelectItem key={unit.code} value={unit.code}>
                                      {unit.code}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">
                              {percent != null ? `${percent.toFixed(1)}%` : "—"}
                            </td>
                            <td className="px-3 py-2">
                              {lineCost != null ? `€${formatMoney(lineCost)}` : "—"}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => removeRow(row.key)}
                              >
                                {t("recipes.removeIngredient")}
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSubRecipePickerOpen((v) => !v)}
                  disabled={recipeOptions.length === 0}
                >
                  {t("recipes.addSubRecipeIngredient")}
                </Button>
                {subRecipePickerOpen && (
                  <div className="mt-2 flex items-end gap-2">
                    <Select value={subRecipePick} onValueChange={setSubRecipePick}>
                      <SelectTrigger className="w-full">
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
                    <Button type="button" size="sm" onClick={handleAddSubRecipeRow}>
                      {t("common.add")}
                    </Button>
                  </div>
                )}
              </div>

              <div className="rounded-lg border bg-muted/30 p-3">
                <h4 className="text-xs font-semibold text-muted-foreground">
                  {t("recipes.results")}
                </h4>
                <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">{t("recipes.ingredientsWeight")}</dt>
                  <dd>{totalWeightGrams.toFixed(0)} g</dd>
                  <dt className="text-muted-foreground">{t("recipes.totalCost")}</dt>
                  <dd>€{formatMoney(totalCostMicros)}</dd>
                  <dt className="text-muted-foreground">{t("recipes.costPerYieldUnit")}</dt>
                  <dd>
                    {costPerYieldUnitMicros != null
                      ? `€${formatMoney(costPerYieldUnitMicros, 4)}`
                      : "—"}
                  </dd>
                  {portions != null && (
                    <>
                      <dt className="text-muted-foreground">{t("recipes.numberOfPortions")}</dt>
                      <dd>{portions.toFixed(1)}</dd>
                      <dt className="text-muted-foreground">{t("recipes.costPerPortion")}</dt>
                      <dd>
                        {costPerPortionMicros != null
                          ? `€${formatMoney(costPerPortionMicros)}`
                          : "—"}
                      </dd>
                    </>
                  )}
                </dl>
                {hasIncompleteCost && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t("recipes.costIncompleteHint")}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

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
