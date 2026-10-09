import { useCallback, useEffect, useMemo, useState } from "react";
import { resolveRawMaterialPrice } from "@pastry-management/core";
import type { CostingRawMaterial } from "@pastry-management/core";
import * as categoriesApi from "../../api/categories";
import * as rawMaterialsApi from "../../api/rawMaterials";
import { createPurchaseRecord } from "../../api/purchaseRecords";
import { listRawMaterialCosting } from "../../api/recipes";
import { listSuppliers } from "../../api/suppliers";
import { UNIT_LABEL_KEYS } from "../../api/types";
import type {
  BaseUnitCode,
  Category,
  RawMaterial,
  RawMaterialInput,
  Supplier,
} from "../../api/types";
import { useI18n } from "../../lib/i18n";
import { compareNullable } from "../../lib/sorting";
import { ImportDialog } from "./ImportDialog";
import { RawMaterialDetail } from "./RawMaterialDetail";
import { RawMaterialForm } from "./RawMaterialForm";
import type { InitialPurchaseInput } from "./RawMaterialForm";
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

type Panel = { mode: "closed" } | { mode: "create" } | { mode: "edit"; material: RawMaterial };
type SortField = "name" | "category" | "price" | "status";
type StatusFilter = "" | "active" | "archived";

function formatMoney(micros: number, digits: number): string {
  return (micros / 1_000_000).toFixed(digits);
}

interface RawMaterialsScreenProps {
  /** Set (once) to jump straight into the create form on mount — e.g. a "Add raw material"
   * shortcut elsewhere in the app navigating here. Consumed via `onAutoOpenCreateHandled` so
   * navigating back to this tab later doesn't reopen the form every time. */
  autoOpenCreate?: boolean;
  onAutoOpenCreateHandled?: () => void;
}

export function RawMaterialsScreen({
  autoOpenCreate,
  onAutoOpenCreateHandled,
}: RawMaterialsScreenProps = {}) {
  const { t, te } = useI18n();
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [costingById, setCostingById] = useState<Map<number, CostingRawMaterial>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>({ mode: "closed" });
  const [rowError, setRowError] = useState<string | null>(null);
  const [selectedMaterial, setSelectedMaterial] = useState<RawMaterial | null>(null);
  const [justCreated, setJustCreated] = useState(false);

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
      rawMaterialsApi.listRawMaterials(true),
      // Include inactive suppliers/categories too, so historical records (which may reference an
      // archived one) can still resolve a display name.
      listSuppliers(true),
      categoriesApi.listCategories(true),
      // Active materials only — an archived material's price isn't relevant to surface here, and
      // this mirrors the same active-only costing data the recipe editor's ingredient picker uses.
      listRawMaterialCosting(),
    ])
      .then(([materialsResult, suppliersResult, categoriesResult, costingResult]) => {
        setMaterials(materialsResult);
        setSuppliers(suppliersResult);
        setCategories(categoriesResult);
        setCostingById(new Map(costingResult.map((c) => [c.id, c])));
      })
      .catch((err) => setLoadError(te(err)))
      .finally(() => setLoading(false));
  }, [te]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!autoOpenCreate) return;
    setPanel({ mode: "create" });
    onAutoOpenCreateHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once per truthy autoOpenCreate; the parent clears it right after, so it shouldn't re-fire on its own
  }, [autoOpenCreate]);

  const categoryName = useCallback(
    (categoryId: number | null): string => {
      if (categoryId === null) return "—";
      return categories.find((c) => c.id === categoryId)?.name ?? `Category #${categoryId}`;
    },
    [categories],
  );

  const unitLabel = useCallback(
    (code: string): string => {
      const key = UNIT_LABEL_KEYS[code as BaseUnitCode];
      return key ? t(key) : code;
    },
    [t],
  );

  const resolvedPrice = useCallback(
    (material: RawMaterial): number | null => {
      const costing = costingById.get(material.id);
      if (!costing) return null;
      try {
        return resolveRawMaterialPrice(costing).costPerBaseUnitMicros.toNumber();
      } catch {
        return null;
      }
    },
    [costingById],
  );

  const priceLabel = useCallback(
    (material: RawMaterial): string => {
      const unit = unitLabel(material.base_unit_code);
      const price = resolvedPrice(material);
      return price == null ? `—/${unit}` : `€${formatMoney(price, 2)}/${unit}`;
    },
    [resolvedPrice, unitLabel],
  );

  const visibleMaterials = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = materials.filter((material) => {
      if (query !== "" && !material.name.toLowerCase().includes(query)) return false;
      if (categoryFilter !== "" && String(material.category_id) !== categoryFilter) return false;
      if (statusFilter === "active" && !material.is_active) return false;
      if (statusFilter === "archived" && material.is_active) return false;
      return true;
    });

    const sortKey = (material: RawMaterial): string | number | null => {
      switch (sortField) {
        case "name":
          return material.name;
        case "category":
          return material.category_id != null ? categoryName(material.category_id) : null;
        case "price":
          return resolvedPrice(material);
        case "status":
          return material.is_active ? 0 : 1;
      }
    };

    return [...filtered].sort((a, b) => compareNullable(sortKey(a), sortKey(b), sortDirection));
  }, [
    materials,
    search,
    categoryFilter,
    statusFilter,
    sortField,
    sortDirection,
    categoryName,
    resolvedPrice,
  ]);

  async function handleCreateCategory(name: string): Promise<Category> {
    const created = await categoriesApi.createCategory({ name });
    // Optimistic append so a category picker mid-render (e.g. inside RawMaterialForm) can select
    // it immediately, without waiting for the full `refresh()` round-trip below to land.
    setCategories((current) => [...current, created]);
    refresh();
    return created;
  }

  async function handleCreate(
    input: RawMaterialInput,
    initialPurchase: InitialPurchaseInput | null,
  ) {
    const created = await rawMaterialsApi.createRawMaterial(input);
    if (initialPurchase) {
      await createPurchaseRecord({
        raw_material_id: created.id,
        expiration_date: null,
        notes: null,
        ...initialPurchase,
      });
    }
    setPanel({ mode: "closed" });
    // Jump straight into the new material's detail view rather than back to the list — if no
    // starting price was given above, recording one is otherwise an easy-to-miss next step.
    setJustCreated(!initialPurchase);
    setSelectedMaterial(created);
    refresh();
  }

  async function handleUpdate(id: number, input: RawMaterialInput) {
    await rawMaterialsApi.updateRawMaterial(id, input);
    setPanel({ mode: "closed" });
    refresh();
  }

  async function handleArchiveToggle(material: RawMaterial) {
    setRowError(null);
    try {
      if (material.is_active) {
        await rawMaterialsApi.archiveRawMaterial(material.id);
      } else {
        await rawMaterialsApi.reactivateRawMaterial(material.id);
      }
      refresh();
    } catch (err) {
      setRowError(te(err));
    }
  }

  async function handleDelete(id: number) {
    setRowError(null);
    try {
      await rawMaterialsApi.deleteRawMaterial(id);
      refresh();
    } catch (err) {
      setRowError(te(err));
    }
  }

  if (selectedMaterial) {
    return (
      <RawMaterialDetail
        material={selectedMaterial}
        suppliers={suppliers}
        categories={categories}
        justCreated={justCreated}
        onBack={() => {
          setSelectedMaterial(null);
          setJustCreated(false);
          refresh();
        }}
      />
    );
  }

  const activeSuppliers = suppliers.filter((s) => s.is_active);
  const activeCategories = categories.filter((c) => c.is_active);

  const sortOptions = [
    { value: "name", label: t("common.name") },
    { value: "category", label: t("common.category") },
    { value: "price", label: t("common.price") },
    { value: "status", label: t("common.status") },
  ];

  const rawMaterialFilters: ListToolbarFilter[] = [
    {
      key: "category",
      label: t("common.category"),
      value: categoryFilter,
      onChange: setCategoryFilter,
      options: [
        { value: "", label: t("common.allCategories") },
        ...[...categories]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((c) => ({ value: String(c.id), label: c.name })),
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
        <h2 className="font-heading text-xl font-semibold">{t("rawMaterials.title")}</h2>
        <div className="flex items-center gap-4">
          <ImportDialog onImported={refresh} />
          <Button type="button" onClick={() => setPanel({ mode: "create" })}>
            {t("rawMaterials.addRawMaterial")}
          </Button>
        </div>
      </div>

      <ListToolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("rawMaterials.searchPlaceholder")}
        filters={rawMaterialFilters}
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
            <CardTitle>{t("rawMaterials.addRawMaterial")}</CardTitle>
          </CardHeader>
          <CardContent>
            <RawMaterialForm
              suppliers={activeSuppliers}
              categories={activeCategories}
              onCreateCategory={handleCreateCategory}
              onSubmit={handleCreate}
              onCancel={() => setPanel({ mode: "closed" })}
            />
          </CardContent>
        </Card>
      )}

      {panel.mode === "edit" && (
        <Card>
          <CardHeader>
            <CardTitle>{t("rawMaterials.editRawMaterial")}</CardTitle>
          </CardHeader>
          <CardContent>
            <RawMaterialForm
              initial={panel.material}
              suppliers={activeSuppliers}
              categories={activeCategories}
              onCreateCategory={handleCreateCategory}
              onSubmit={(input) => handleUpdate(panel.material.id, input)}
              onCancel={() => setPanel({ mode: "closed" })}
            />
          </CardContent>
        </Card>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : materials.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("rawMaterials.empty")}</p>
      ) : visibleMaterials.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("common.noMatches")}</p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.name")}</TableHead>
                <TableHead>{t("common.category")}</TableHead>
                <TableHead>{t("rawMaterials.pricePerBaseUnit")}</TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead>{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleMaterials.map((material) => (
                <TableRow key={material.id}>
                  <TableCell>
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto p-0"
                      onClick={() => setSelectedMaterial(material)}
                    >
                      {material.name}
                    </Button>
                  </TableCell>
                  <TableCell>{categoryName(material.category_id)}</TableCell>
                  <TableCell>{priceLabel(material)}</TableCell>
                  <TableCell>
                    <Badge variant={material.is_active ? "success" : "destructive"}>
                      {material.is_active ? t("common.active") : t("common.archived")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setPanel({ mode: "edit", material })}
                      >
                        {t("common.edit")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleArchiveToggle(material)}
                      >
                        {material.is_active ? t("common.archive") : t("common.reactivate")}
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
                              {t("common.deleteConfirmTitle").replace("{name}", material.name)}
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              {t("rawMaterials.deleteConfirmBody")}{" "}
                              {t("common.deleteCannotBeUndone")}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                            <AlertDialogAction
                              variant="destructive"
                              onClick={() => handleDelete(material.id)}
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
