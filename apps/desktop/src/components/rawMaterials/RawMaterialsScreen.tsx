import { useCallback, useEffect, useState } from "react";
import { toAppError } from "../../api/errors";
import * as rawMaterialsApi from "../../api/rawMaterials";
import { createPurchaseRecord } from "../../api/purchaseRecords";
import { listSuppliers } from "../../api/suppliers";
import { UNIT_LABELS } from "../../api/types";
import type { BaseUnitCode, RawMaterial, RawMaterialInput, Supplier } from "../../api/types";
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

function unitLabel(code: string): string {
  return UNIT_LABELS[code as BaseUnitCode] ?? code;
}

export function RawMaterialsScreen() {
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>({ mode: "closed" });
  const [rowError, setRowError] = useState<string | null>(null);
  const [selectedMaterial, setSelectedMaterial] = useState<RawMaterial | null>(null);
  const [justCreated, setJustCreated] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    Promise.all([
      rawMaterialsApi.listRawMaterials(includeInactive),
      // Include inactive suppliers too, so historical purchase records (which may reference an
      // archived supplier) can still resolve a display name.
      listSuppliers(true),
    ])
      .then(([materialsResult, suppliersResult]) => {
        setMaterials(materialsResult);
        setSuppliers(suppliersResult);
      })
      .catch((err) => setLoadError(toAppError(err).message))
      .finally(() => setLoading(false));
  }, [includeInactive]);

  useEffect(() => {
    refresh();
  }, [refresh]);

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
      setRowError(toAppError(err).message);
    }
  }

  async function handleDelete(id: number) {
    setRowError(null);
    try {
      await rawMaterialsApi.deleteRawMaterial(id);
      refresh();
    } catch (err) {
      setRowError(toAppError(err).message);
    }
  }

  if (selectedMaterial) {
    return (
      <RawMaterialDetail
        material={selectedMaterial}
        suppliers={suppliers}
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
  const categories = Array.from(
    new Set(materials.map((m) => m.category).filter((c): c is string => !!c)),
  ).sort((a, b) => a.localeCompare(b));

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="font-heading text-xl font-semibold">Raw Materials</h2>
        <div className="flex items-center gap-4">
          <Label className="flex items-center gap-2 font-normal">
            <Checkbox
              checked={includeInactive}
              onCheckedChange={(checked) => setIncludeInactive(checked === true)}
            />
            Show inactive
          </Label>
          <Button type="button" onClick={() => setPanel({ mode: "create" })}>
            Add raw material
          </Button>
        </div>
      </div>

      {rowError && <p className="text-sm font-medium text-destructive">{rowError}</p>}
      {loadError && <p className="text-sm font-medium text-destructive">{loadError}</p>}

      {panel.mode === "create" && (
        <Card>
          <CardHeader>
            <CardTitle>Add raw material</CardTitle>
          </CardHeader>
          <CardContent>
            <RawMaterialForm
              suppliers={activeSuppliers}
              categories={categories}
              onSubmit={handleCreate}
              onCancel={() => setPanel({ mode: "closed" })}
            />
          </CardContent>
        </Card>
      )}

      {panel.mode === "edit" && (
        <Card>
          <CardHeader>
            <CardTitle>Edit raw material</CardTitle>
          </CardHeader>
          <CardContent>
            <RawMaterialForm
              initial={panel.material}
              suppliers={activeSuppliers}
              categories={categories}
              onSubmit={(input) => handleUpdate(panel.material.id, input)}
              onCancel={() => setPanel({ mode: "closed" })}
            />
          </CardContent>
        </Card>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : materials.length === 0 ? (
        <p className="text-sm text-muted-foreground">No raw materials yet.</p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Base unit</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
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
                  <TableCell>{material.category ?? "—"}</TableCell>
                  <TableCell>{unitLabel(material.base_unit_code)}</TableCell>
                  <TableCell>
                    <Badge variant={material.is_active ? "default" : "secondary"}>
                      {material.is_active ? "Active" : "Archived"}
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
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleArchiveToggle(material)}
                      >
                        {material.is_active ? "Archive" : "Reactivate"}
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button type="button" variant="destructive" size="sm">
                            Delete
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete "{material.name}"?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This permanently deletes the raw material. This cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              variant="destructive"
                              onClick={() => handleDelete(material.id)}
                            >
                              Delete
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
