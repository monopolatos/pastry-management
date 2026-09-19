import { useEffect, useState } from "react";
import { DatabaseBackup } from "lucide-react";
import { toAppError } from "../../api/errors";
import { listRawMaterials } from "../../api/rawMaterials";
import { listRecentPurchaseRecords } from "../../api/purchaseRecords";
import { listRecipes } from "../../api/recipes";
import { listSuppliers } from "../../api/suppliers";
import type { RecentPurchaseRecord, RecipeSummary } from "../../api/types";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Skeleton } from "../ui/skeleton";
import { useI18n } from "../../lib/i18n";

interface Counts {
  rawMaterials: number;
  recipes: number;
  suppliers: number;
}

function formatMoney(micros: number, digits = 4): string {
  return (micros / 1_000_000).toFixed(digits);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

/**
 * Landing screen: at-a-glance counts, recently modified recipes, and recent purchase activity.
 * Every number here comes from data the app already has — no new backend aggregation beyond the
 * `list_recent_purchase_records` command (see api/purchaseRecords.ts).
 */
export function DashboardScreen() {
  const { t } = useI18n();
  const [counts, setCounts] = useState<Counts | null>(null);
  const [recentRecipes, setRecentRecipes] = useState<RecipeSummary[]>([]);
  const [recentPurchases, setRecentPurchases] = useState<RecentPurchaseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    Promise.all([
      listRawMaterials(false),
      listRecipes(false),
      listSuppliers(false),
      listRecentPurchaseRecords(8),
    ])
      .then(([materials, recipes, suppliers, purchases]) => {
        if (cancelled) return;
        setCounts({
          rawMaterials: materials.length,
          recipes: recipes.length,
          suppliers: suppliers.length,
        });
        const sortedRecipes = [...recipes].sort(
          (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
        );
        setRecentRecipes(sortedRecipes.slice(0, 5));
        setRecentPurchases(purchases);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(toAppError(err).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="flex flex-col gap-6">
      {loadError && <p className="text-sm font-medium text-destructive">{loadError}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">
              {t("dashboard.activeRawMaterials")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <p className="text-3xl font-semibold">{counts?.rawMaterials ?? 0}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">
              {t("dashboard.activeRecipes")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <p className="text-3xl font-semibold">{counts?.recipes ?? 0}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">
              {t("dashboard.activeSuppliers")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <p className="text-3xl font-semibold">{counts?.suppliers ?? 0}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("dashboard.recentRecipes")}</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
              </div>
            ) : recentRecipes.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("dashboard.noRecentRecipes")}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {recentRecipes.map((recipe) => (
                  <li key={recipe.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate font-medium">{recipe.name}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {formatDate(recipe.updated_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("dashboard.recentPriceUpdates")}</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
              </div>
            ) : recentPurchases.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("dashboard.noRecentPurchases")}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {recentPurchases.map((purchase) => (
                  <li key={purchase.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate font-medium">{purchase.raw_material_name}</span>
                    <span className="shrink-0 text-muted-foreground">
                      €{formatMoney(purchase.cost_per_base_unit_micros)}/{purchase.base_unit_code} —{" "}
                      {formatDate(purchase.purchase_date)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DatabaseBackup className="size-4" />
            {t("dashboard.backupStatus")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t("dashboard.backupNotConfigured")}</p>
        </CardContent>
      </Card>
    </section>
  );
}
