import { useCallback, useEffect, useState } from "react";
import { ChefHat, TrendingDown, TrendingUp, Wheat } from "lucide-react";
import * as categoriesApi from "../../api/categories";
import * as expenseCategoriesApi from "../../api/expenseCategories";
import * as incomeCategoriesApi from "../../api/incomeCategories";
import * as recipeCategoriesApi from "../../api/recipeCategories";
import type { Category } from "../../api/types";
import { useI18n } from "../../lib/i18n";
import { CategoryManager } from "./CategoryManager";

/**
 * Dedicated "Categories" nav entry — manages every managed category type side by side, each its
 * own independent entity (see migrations 0007, 0010, 0011): raw material, recipe, expense, and
 * income categories. Previously raw material categories were only reachable via a "Manage
 * categories" button buried on the Raw Materials screen, and the others had no managed categories
 * at all (free text, or didn't exist yet).
 */
export function CategoriesScreen() {
  const { t, te } = useI18n();
  const [materialCategories, setMaterialCategories] = useState<Category[]>([]);
  const [recipeCategories, setRecipeCategories] = useState<Category[]>([]);
  const [expenseCategories, setExpenseCategories] = useState<Category[]>([]);
  const [incomeCategories, setIncomeCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    Promise.all([
      categoriesApi.listCategories(true),
      recipeCategoriesApi.listRecipeCategories(true),
      expenseCategoriesApi.listExpenseCategories(true),
      incomeCategoriesApi.listIncomeCategories(true),
    ])
      .then(([materials, recipes, expenses, income]) => {
        setMaterialCategories(materials);
        setRecipeCategories(recipes);
        setExpenseCategories(expenses);
        setIncomeCategories(income);
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
          <CategoryManager
            title={t("categories.expenseCategories")}
            icon={TrendingDown}
            categories={expenseCategories}
            deleteConfirmBody={t("categories.expenseDeleteConfirmBody")}
            onChanged={refresh}
            api={{
              create: expenseCategoriesApi.createExpenseCategory,
              update: expenseCategoriesApi.updateExpenseCategory,
              archive: expenseCategoriesApi.archiveExpenseCategory,
              reactivate: expenseCategoriesApi.reactivateExpenseCategory,
              delete: expenseCategoriesApi.deleteExpenseCategory,
            }}
          />
          <CategoryManager
            title={t("categories.incomeCategories")}
            icon={TrendingUp}
            categories={incomeCategories}
            deleteConfirmBody={t("categories.incomeDeleteConfirmBody")}
            onChanged={refresh}
            api={{
              create: incomeCategoriesApi.createIncomeCategory,
              update: incomeCategoriesApi.updateIncomeCategory,
              archive: incomeCategoriesApi.archiveIncomeCategory,
              reactivate: incomeCategoriesApi.reactivateIncomeCategory,
              delete: incomeCategoriesApi.deleteIncomeCategory,
            }}
          />
        </div>
      )}
    </section>
  );
}
