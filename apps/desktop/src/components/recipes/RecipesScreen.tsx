import { useCallback, useEffect, useMemo, useState } from "react";
import { calculateRecipeCost } from "@pastry-management/core";
import type { CostingRawMaterial } from "@pastry-management/core";
import { listMeasurementUnits } from "../../api/measurementUnits";
import { listRawMaterials } from "../../api/rawMaterials";
import { listRecipeCategories } from "../../api/recipeCategories";
import * as recipesApi from "../../api/recipes";
import { UNIT_KIND_LABEL_KEYS } from "../../api/types";
import type {
  Category,
  MeasurementUnit,
  RawMaterial,
  RecipeDetail as RecipeDetailData,
  RecipeInput,
  RecipeSummary,
} from "../../api/types";
import { useI18n } from "../../lib/i18n";
import { compareNullable } from "../../lib/sorting";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { ListToolbar } from "../shared/ListToolbar";
import type { ListToolbarFilter } from "../shared/ListToolbar";

type Panel = { mode: "closed" } | { mode: "create" } | { mode: "edit"; recipe: RecipeDetailData };
type SortField = "name" | "category" | "price" | "status";
type StatusFilter = "" | "active" | "archived";

function formatMoney(micros: number): string {
  return (micros / 1_000_000).toFixed(2);
}

interface RecipesScreenProps {
  /** Set (once) to jump straight into the create form on mount — e.g. a "Add recipe" shortcut
   * elsewhere in the app navigating here. Consumed via `onAutoOpenCreateHandled` so navigating
   * back to this tab later doesn't reopen the form every time. */
  autoOpenCreate?: boolean;
  onAutoOpenCreateHandled?: () => void;
}

export function RecipesScreen({
  autoOpenCreate,
  onAutoOpenCreateHandled,
}: RecipesScreenProps = {}) {
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
  const [rawMaterialCosting, setRawMaterialCosting] = useState<CostingRawMaterial[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [units, setUnits] = useState<MeasurementUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>({ mode: "closed" });
  const [rowError, setRowError] = useState<string | null>(null);
  const [selectedRecipe, setSelectedRecipe] = useState<RecipeDetailData | null>(null);
  // Total cost per recipe, computed client-side the same way the detail/cost-calculator screens
  // do. `null` means it couldn't be calculated (e.g. an ingredient has no purchase history yet),
  // not "zero cost" — rendered as "—" rather than a misleading €0.00.
  const [costByRecipeId, setCostByRecipeId] = useState<Map<number, number | null>>(new Map());

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const refresh = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    Promise.all([
      // Always fetch both active and archived — the status filter below is applied client-side,
      // so switching it doesn't need a round trip.
      recipesApi.listRecipes(true),
      recipesApi.listRecipes(false),
      listRawMaterials(false),
      listMeasurementUnits(),
      recipesApi.listRawMaterialCosting(),
      // Active only — an archived category can't be picked for a new/edited recipe.
      listRecipeCategories(false),
    ])
      .then(
        ([
          recipesResult,
          activeResult,
          materialsResult,
          unitsResult,
          costingResult,
          categoriesResult,
        ]) => {
          setRecipes(recipesResult);
          setActiveRecipes(activeResult);
          setRawMaterials(materialsResult);
          setUnits(unitsResult);
          setRawMaterialCosting(costingResult);
          setCategories(categoriesResult);
        },
      )
      .catch((err) => setLoadError(te(err)))
      .finally(() => setLoading(false));
  }, [te]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (recipes.length === 0) {
      setCostByRecipeId(new Map());
      return;
    }
    let cancelled = false;
    Promise.all(
      recipes.map(async (recipe) => {
        try {
          const graph = await recipesApi.getRecipeCostingGraph(recipe.id);
          return [recipe.id, calculateRecipeCost(graph).totalCostMicros] as const;
        } catch {
          return [recipe.id, null] as const;
        }
      }),
    ).then((entries) => {
      if (!cancelled) setCostByRecipeId(new Map(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [recipes]);

  useEffect(() => {
    if (!autoOpenCreate) return;
    setPanel({ mode: "create" });
    onAutoOpenCreateHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once per truthy autoOpenCreate; the parent clears it right after, so it shouldn't re-fire on its own
  }, [autoOpenCreate]);

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

  const visibleRecipes = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = recipes.filter((recipe) => {
      if (query !== "" && !recipe.name.toLowerCase().includes(query)) return false;
      if (categoryFilter !== "" && recipe.category !== categoryFilter) return false;
      if (statusFilter === "active" && recipe.status !== "active") return false;
      if (statusFilter === "archived" && recipe.status !== "archived") return false;
      return true;
    });

    const sortKey = (recipe: RecipeSummary): string | number | null => {
      switch (sortField) {
        case "name":
          return recipe.name;
        case "category":
          return recipe.category;
        case "price":
          return costByRecipeId.get(recipe.id) ?? null;
        case "status":
          return recipe.status === "active" ? 0 : 1;
      }
    };

    return [...filtered].sort((a, b) => compareNullable(sortKey(a), sortKey(b), sortDirection));
  }, [recipes, search, categoryFilter, statusFilter, sortField, sortDirection, costByRecipeId]);

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

  const sortOptions = [
    { value: "name", label: t("common.name") },
    { value: "category", label: t("common.category") },
    { value: "price", label: t("common.price") },
    { value: "status", label: t("common.status") },
  ];

  const recipeFilters: ListToolbarFilter[] = [
    {
      key: "category",
      label: t("common.category"),
      value: categoryFilter,
      onChange: setCategoryFilter,
      options: [
        { value: "", label: t("common.allCategories") },
        ...[...categories]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((c) => ({ value: c.name, label: c.name })),
      ],
    },
    {
      key: "status",
      label: t("common.status"),
      value: statusFilter,
      onChange: (v) => setStatusFilter(v as StatusFilter),
      options: [
        { value: "", label: t("common.allStatuses") },
        { value: "active", label: t("common.active") },
        { value: "archived", label: t("common.archived") },
      ],
    },
  ];

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="font-heading text-xl font-semibold">{t("recipes.title")}</h2>
        <div className="flex items-center gap-4">
          <Button type="button" onClick={() => setPanel({ mode: "create" })}>
            {t("recipes.addRecipe")}
          </Button>
        </div>
      </div>

      <ListToolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("recipes.searchPlaceholder")}
        filters={recipeFilters}
        sortOptions={sortOptions}
        sortValue={sortField}
        onSortChange={(v) => setSortField(v as SortField)}
        sortDirection={sortDirection}
        onToggleSortDirection={() => setSortDirection((d) => (d === "asc" ? "desc" : "asc"))}
        sortLabel={t("common.sortBy")}
      />

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
              rawMaterialCosting={rawMaterialCosting}
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
              rawMaterialCosting={rawMaterialCosting}
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
      ) : visibleRecipes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("common.noMatches")}</p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.name")}</TableHead>
                <TableHead>{t("common.category")}</TableHead>
                <TableHead>{t("recipes.yield")}</TableHead>
                <TableHead>{t("recipes.calculatedPrice")}</TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead>{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRecipes.map((recipe) => {
                const cost = costByRecipeId.get(recipe.id);
                return (
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
                      {cost === undefined
                        ? t("common.loading")
                        : cost === null
                          ? "—"
                          : `€${formatMoney(cost)}`}
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
                          {recipe.status === "active"
                            ? t("common.archive")
                            : t("common.reactivate")}
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
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
