import { useEffect, useMemo, useState } from "react";
import { resolveRawMaterialPrice } from "@pastry-management/core";
import type { CostingRawMaterial } from "@pastry-management/core";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { listPurchaseRecordsForMaterial } from "../../api/purchaseRecords";
import { listRawMaterials } from "../../api/rawMaterials";
import * as recipesApi from "../../api/recipes";
import { UNIT_LABEL_KEYS } from "../../api/types";
import type { BaseUnitCode, PurchaseRecord, RawMaterial, RecipeSummary } from "../../api/types";
import { useI18n } from "../../lib/i18n";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Skeleton } from "../ui/skeleton";

type PriceHistoryKind = "material" | "recipe";

interface PricePoint {
  date: string;
  price: number;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

function formatMoney(value: number, digits = 4): string {
  return value.toFixed(digits);
}

/**
 * At-a-glance counts, a bar chart of the 10 currently most expensive raw materials, and a picker
 * for a single material's purchase-price history or a single recipe's saved cost-snapshot
 * history. Reuses the exact same client-side price resolution (`resolveRawMaterialPrice`) the
 * raw materials list and recipe editor already use — no new backend aggregation beyond commands
 * that already existed (list_purchase_records_for_material, list_recipe_cost_snapshots).
 */
export function AnalyticsScreen() {
  const { t, te } = useI18n();
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [materialCosting, setMaterialCosting] = useState<CostingRawMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [historyKind, setHistoryKind] = useState<PriceHistoryKind>("material");
  const [historyId, setHistoryId] = useState<string>("");
  const [historyPoints, setHistoryPoints] = useState<PricePoint[] | null>(null);
  const [historyUnit, setHistoryUnit] = useState<string>("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    Promise.all([
      listRawMaterials(false),
      recipesApi.listRecipes(false),
      recipesApi.listRawMaterialCosting(),
    ])
      .then(([materialsResult, recipesResult, costingResult]) => {
        if (cancelled) return;
        setMaterials(materialsResult);
        setRecipes(recipesResult);
        setMaterialCosting(costingResult);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(te(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [te]);

  function unitLabel(code: string): string {
    const key = UNIT_LABEL_KEYS[code as BaseUnitCode];
    return key ? t(key) : code;
  }

  const topExpensive = useMemo(() => {
    const costingById = new Map(materialCosting.map((c) => [c.id, c]));
    const rows: { name: string; price: number; unit: string }[] = [];
    for (const material of materials) {
      const costing = costingById.get(material.id);
      if (!costing) continue;
      try {
        const resolved = resolveRawMaterialPrice(costing);
        rows.push({
          name: material.name,
          price: resolved.costPerBaseUnitMicros.toNumber() / 1_000_000,
          unit: unitLabel(material.base_unit_code),
        });
      } catch {
        // No resolvable price (e.g. no purchase history yet) — excluded from the ranking.
      }
    }
    return rows.sort((a, b) => b.price - a.price).slice(0, 10);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unitLabel depends only on `t`, stable enough for this derived list
  }, [materials, materialCosting]);

  function handleHistoryKindChange(kind: PriceHistoryKind) {
    setHistoryKind(kind);
    setHistoryId("");
    setHistoryPoints(null);
    setHistoryError(null);
  }

  function handleHistorySelect(value: string) {
    setHistoryId(value);
    setHistoryPoints(null);
    setHistoryError(null);
    const id = Number(value);
    if (!Number.isFinite(id)) return;

    setHistoryLoading(true);
    if (historyKind === "material") {
      const material = materials.find((m) => m.id === id);
      setHistoryUnit(material ? unitLabel(material.base_unit_code) : "");
      listPurchaseRecordsForMaterial(id)
        .then((records: PurchaseRecord[]) => {
          const sorted = [...records].sort((a, b) =>
            a.purchase_date.localeCompare(b.purchase_date),
          );
          setHistoryPoints(
            sorted.map((r) => ({
              date: r.purchase_date,
              price: r.cost_per_base_unit_micros / 1_000_000,
            })),
          );
        })
        .catch((err) => setHistoryError(te(err)))
        .finally(() => setHistoryLoading(false));
    } else {
      const recipe = recipes.find((r) => r.id === id);
      setHistoryUnit(recipe ? unitLabel(recipe.yield_unit_code) : "");
      recipesApi
        .listRecipeCostSnapshots(id)
        .then((snapshots) => {
          const sorted = [...snapshots].sort((a, b) =>
            a.calculated_at.localeCompare(b.calculated_at),
          );
          setHistoryPoints(
            sorted.map((s) => ({
              date: s.calculated_at,
              price: s.cost_per_yield_unit_micros / 1_000_000,
            })),
          );
        })
        .catch((err) => setHistoryError(te(err)))
        .finally(() => setHistoryLoading(false));
    }
  }

  return (
    <section className="flex flex-col gap-6">
      {loadError && <p className="text-sm font-medium text-destructive">{loadError}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">
              {t("analytics.totalRawMaterials")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <p className="text-3xl font-semibold">{materials.length}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">
              {t("analytics.totalRecipes")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <p className="text-3xl font-semibold">{recipes.length}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("analytics.mostExpensiveMaterials")}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-72 w-full" />
          ) : topExpensive.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("analytics.noPricedMaterials")}</p>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={topExpensive} margin={{ bottom: 64 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="name"
                  interval={0}
                  angle={-40}
                  textAnchor="end"
                  height={80}
                  tick={{ fontSize: 12 }}
                />
                <YAxis tickFormatter={(v: number) => `€${formatMoney(v, 2)}`} />
                <Tooltip
                  formatter={(value, _name, entry) => [
                    `€${formatMoney(Number(value))}/${(entry.payload as { unit: string }).unit}`,
                    t("analytics.price"),
                  ]}
                />
                <Bar dataKey="price" fill="var(--primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("analytics.priceHistory")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex gap-1.5">
              <Button
                type="button"
                size="sm"
                variant={historyKind === "material" ? "default" : "outline"}
                onClick={() => handleHistoryKindChange("material")}
              >
                {t("nav.rawMaterials")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={historyKind === "recipe" ? "default" : "outline"}
                onClick={() => handleHistoryKindChange("recipe")}
              >
                {t("nav.recipes")}
              </Button>
            </div>
            <Select value={historyId} onValueChange={handleHistorySelect} disabled={loading}>
              <SelectTrigger className="w-full max-w-sm">
                <SelectValue placeholder={t("analytics.selectItemPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {(historyKind === "material" ? materials : recipes).map((item) => (
                  <SelectItem key={item.id} value={String(item.id)}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {historyError && <p className="text-sm font-medium text-destructive">{historyError}</p>}
          {historyLoading && <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}

          {!historyLoading &&
            historyId !== "" &&
            historyPoints != null &&
            (historyPoints.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {historyKind === "material"
                  ? t("analytics.noPurchaseHistory")
                  : t("analytics.noCostSnapshots")}
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={historyPoints}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fontSize: 12 }} />
                  <YAxis
                    tickFormatter={(v: number) => `€${formatMoney(v, 2)}`}
                    tick={{ fontSize: 12 }}
                  />
                  <Tooltip
                    labelFormatter={(label) => formatDate(String(label))}
                    formatter={(value) => [
                      `€${formatMoney(Number(value))}/${historyUnit}`,
                      t("analytics.price"),
                    ]}
                  />
                  <Line
                    type="monotone"
                    dataKey="price"
                    stroke="var(--primary)"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ))}
        </CardContent>
      </Card>
    </section>
  );
}
