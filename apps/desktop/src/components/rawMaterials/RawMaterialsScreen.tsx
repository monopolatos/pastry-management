import { useCallback, useEffect, useState } from "react";
import * as categoriesApi from "../../api/categories";
import * as rawMaterialsApi from "../../api/rawMaterials";
import { createPurchaseRecord } from "../../api/purchaseRecords";
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
import { CategoriesDialog } from "./CategoriesDialog";
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
import { Checkbox } from "../ui/checkbox";
import { Label } from "../ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

type Panel = { mode: "closed" } | { mode: "create" } | { mode: "edit"; material: RawMaterial };

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
  const [includeInactive, setIncludeInactive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>({ mode: "closed" });
  const [rowError, setRowError] = useState<string | null>(null);
  const [selectedMaterial, setSelectedMaterial] = useState<RawMaterial | null>(null);
  const [justCreated, setJustCreated] = useState(false);
  const [categoriesDialogOpen, setCategoriesDialogOpen] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    Promise.all([
      rawMaterialsApi.listRawMaterials(includeInactive),
      // Include inactive suppliers/categories too, so historical records (which may reference an
      // archived one) can still resolve a display name.
      listSuppliers(true),
      categoriesApi.listCategories(true),
    ])
      .then(([materialsResult, suppliersResult, categoriesResult]) => {
        setMaterials(materialsResult);
        setSuppliers(suppliersResult);
        setCategories(categoriesResult);
      })
      .catch((err) => setLoadError(te(err)))
      .finally(() => setLoading(false));
  }, [includeInactive, te]);

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

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="font-heading text-xl font-semibold">{t("rawMaterials.title")}</h2>
        <div className="flex items-center gap-4">
          <Label className="flex items-center gap-2 font-normal">
            <Checkbox
              checked={includeInactive}
              onCheckedChange={(checked) => setIncludeInactive(checked === true)}
            />
            {t("common.showInactive")}
          </Label>
          <Button type="button" variant="outline" onClick={() => setCategoriesDialogOpen(true)}>
            {t("rawMaterials.manageCategories")}
          </Button>
          <ImportDialog onImported={refresh} />
          <Button type="button" onClick={() => setPanel({ mode: "create" })}>
            {t("rawMaterials.addRawMaterial")}
          </Button>
        </div>
      </div>

      <CategoriesDialog
        open={categoriesDialogOpen}
        onOpenChange={setCategoriesDialogOpen}
        categories={categories}
        onChanged={refresh}
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
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.name")}</TableHead>
                <TableHead>{t("common.category")}</TableHead>
                <TableHead>{t("rawMaterials.baseUnit")}</TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead>{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {materials.map((material) => (
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
                  <TableCell>{unitLabel(material.base_unit_code)}</TableCell>
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
