import { useCallback, useEffect, useState } from "react";
import { ChefHat, Wheat } from "lucide-react";
import * as categoriesApi from "../../api/categories";
import * as recipeCategoriesApi from "../../api/recipeCategories";
import type { Category } from "../../api/types";
import { useI18n } from "../../lib/i18n";
import { CategoryManager } from "./CategoryManager";

/**
 * Dedicated "Categories" nav entry — manages raw material categories and recipe categories side
 * by side, each its own independent managed entity (see migrations 0007 and 0010). Previously raw
 * material categories were only reachable via a "Manage categories" button buried on the Raw
 * Materials screen, and recipes had no managed categories at all (free text).
 */
export function CategoriesScreen() {
  const { t, te } = useI18n();
  const [materialCategories, setMaterialCategories] = useState<Category[]>([]);
  const [recipeCategories, setRecipeCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    Promise.all([
      categoriesApi.listCategories(true),
      recipeCategoriesApi.listRecipeCategories(true),
    ])
      .then(([materials, recipes]) => {
        setMaterialCategories(materials);
        setRecipeCategories(recipes);
      })
      .catch((err) => setLoadError(te(err)))
      .finally(() => setLoading(false));
  }, [te]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-heading text-xl font-semibold">{t("categories.title")}</h2>

      {loadError && <p className="text-sm font-medium text-destructive">{loadError}</p>}

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <CategoryManager
            title={t("categories.materialCategories")}
            icon={Wheat}
            categories={materialCategories}
            deleteConfirmBody={t("categories.deleteConfirmBody")}
            onChanged={refresh}
            api={{
              create: categoriesApi.createCategory,
              update: categoriesApi.updateCategory,
              archive: categoriesApi.archiveCategory,
              reactivate: categoriesApi.reactivateCategory,
              delete: categoriesApi.deleteCategory,
            }}
          />
          <CategoryManager
            title={t("categories.recipeCategories")}
            icon={ChefHat}
            categories={recipeCategories}
            deleteConfirmBody={t("categories.recipeDeleteConfirmBody")}
            onChanged={refresh}
            api={{
              create: recipeCategoriesApi.createRecipeCategory,
              update: recipeCategoriesApi.updateRecipeCategory,
              archive: recipeCategoriesApi.archiveRecipeCategory,
              reactivate: recipeCategoriesApi.reactivateRecipeCategory,
              delete: recipeCategoriesApi.deleteRecipeCategory,
            }}
          />
        </div>
      )}
    </section>
  );
}
