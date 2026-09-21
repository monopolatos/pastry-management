import { useCallback, useEffect, useState } from "react";
import { listMeasurementUnits } from "../../api/measurementUnits";
import { listRawMaterials } from "../../api/rawMaterials";
import * as recipesApi from "../../api/recipes";
import { UNIT_KIND_LABEL_KEYS } from "../../api/types";
import type {
  MeasurementUnit,
  RawMaterial,
  RecipeDetail as RecipeDetailData,
  RecipeInput,
  RecipeSummary,
} from "../../api/types";
import { useI18n } from "../../lib/i18n";
import { RecipeDetail } from "./RecipeDetail";
import { RecipeForm } from "./RecipeForm";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../ui/alert-dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Checkbox } from "../ui/checkbox";
import { Label } from "../ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

type Panel = { mode: "closed" } | { mode: "create" } | { mode: "edit"; recipe: RecipeDetailData };

export function RecipesScreen() {
  const { t, te } = useI18n();

  function unitLabel(units: MeasurementUnit[], code: string): string {
    const unit = units.find((u) => u.code === code);
    if (!unit) return code;
    const kindKey = UNIT_KIND_LABEL_KEYS[unit.kind];
    return `${unit.code} (${kindKey ? t(kindKey) : unit.kind})`;
  }

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
      .catch((err) => setLoadError(te(err)))
      .finally(() => setLoading(false));
  }, [includeArchived, te]);

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
      setRowError(te(err));
    }
  }

  async function openDetail(id: number) {
    setRowError(null);
    try {
      const detail = await recipesApi.getRecipe(id);
      setSelectedRecipe(detail);
    } catch (err) {
      setRowError(te(err));
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
      setRowError(te(err));
    }
  }

  async function handleDuplicate(id: number) {
    setRowError(null);
    try {
      await recipesApi.duplicateRecipe(id, null);
      refresh();
    } catch (err) {
      setRowError(te(err));
    }
  }

  async function handleDelete(id: number) {
    setRowError(null);
    try {
      await recipesApi.deleteRecipe(id);
      refresh();
    } catch (err) {
      setRowError(te(err));
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
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="font-heading text-xl font-semibold">{t("recipes.title")}</h2>
        <div className="flex items-center gap-4">
          <Label className="flex items-center gap-2 font-normal">
            <Checkbox
              checked={includeArchived}
              onCheckedChange={(checked) => setIncludeArchived(checked === true)}
            />
            {t("common.showArchived")}
          </Label>
          <Button type="button" onClick={() => setPanel({ mode: "create" })}>
            {t("recipes.addRecipe")}
          </Button>
        </div>
      </div>

      {rowError && <p className="text-sm font-medium text-destructive">{rowError}</p>}
      {loadError && <p className="text-sm font-medium text-destructive">{loadError}</p>}

      {panel.mode === "create" && (
        <Card>
          <CardHeader>
            <CardTitle>{t("recipes.addRecipe")}</CardTitle>
          </CardHeader>
          <CardContent>
            <RecipeForm
              categories={categories}
              rawMaterials={rawMaterials}
              recipeOptions={activeRecipes}
              units={units}
              onSubmit={handleCreate}
              onCancel={() => setPanel({ mode: "closed" })}
            />
          </CardContent>
        </Card>
      )}

      {panel.mode === "edit" && (
        <Card>
          <CardHeader>
            <CardTitle>{t("recipes.editRecipe")}</CardTitle>
          </CardHeader>
          <CardContent>
            <RecipeForm
              initial={panel.recipe}
              categories={categories}
              rawMaterials={rawMaterials}
              recipeOptions={activeRecipes.filter((r) => r.id !== panel.recipe.id)}
              units={units}
              onSubmit={(input) => handleUpdate(panel.recipe.id, input)}
              onCancel={() => setPanel({ mode: "closed" })}
            />
          </CardContent>
        </Card>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : recipes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("recipes.empty")}</p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.name")}</TableHead>
                <TableHead>{t("common.category")}</TableHead>
                <TableHead>{t("recipes.yield")}</TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead>{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recipes.map((recipe) => (
                <TableRow key={recipe.id}>
                  <TableCell>
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto p-0"
                      onClick={() => openDetail(recipe.id)}
                    >
                      {recipe.name}
                    </Button>
                  </TableCell>
                  <TableCell>{recipe.category ?? "—"}</TableCell>
                  <TableCell>
                    {recipe.yield_quantity} {unitLabel(units, recipe.yield_unit_code)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={recipe.status === "active" ? "success" : "destructive"}>
                      {recipe.status === "active" ? t("common.active") : t("common.archived")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openEdit(recipe.id)}
                      >
                        {t("common.edit")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleArchiveToggle(recipe)}
                      >
                        {recipe.status === "active" ? t("common.archive") : t("common.reactivate")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleDuplicate(recipe.id)}
                      >
                        {t("recipes.duplicate")}
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button type="button" variant="destructive" size="sm">
                            {t("common.delete")}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              {t("common.deleteConfirmTitle").replace("{name}", recipe.name)}
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              {t("recipes.deleteConfirmBody")} {t("common.deleteCannotBeUndone")}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                            <AlertDialogAction
                              variant="destructive"
                              onClick={() => handleDelete(recipe.id)}
                            >
                              {t("common.delete")}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
