import { useCallback, useEffect, useState } from "react";
import * as suppliersApi from "../../api/suppliers";
import type { Supplier, SupplierInput } from "../../api/types";
import { useI18n } from "../../lib/i18n";
import { SupplierForm } from "./SupplierForm";
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

type Panel = { mode: "closed" } | { mode: "create" } | { mode: "edit"; supplier: Supplier };

export function SuppliersScreen() {
  const { t, te } = useI18n();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>({ mode: "closed" });
  const [rowError, setRowError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    suppliersApi
      .listSuppliers(includeInactive)
      .then(setSuppliers)
      .catch((err) => setLoadError(te(err)))
      .finally(() => setLoading(false));
  }, [includeInactive, te]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleCreate(input: SupplierInput) {
    await suppliersApi.createSupplier(input);
    setPanel({ mode: "closed" });
    refresh();
  }

  async function handleUpdate(id: number, input: SupplierInput) {
    await suppliersApi.updateSupplier(id, input);
    setPanel({ mode: "closed" });
    refresh();
  }

  async function handleArchiveToggle(supplier: Supplier) {
    setRowError(null);
    try {
      if (supplier.is_active) {
        await suppliersApi.archiveSupplier(supplier.id);
      } else {
        await suppliersApi.reactivateSupplier(supplier.id);
      }
      refresh();
    } catch (err) {
      setRowError(te(err));
    }
  }

  async function handleDelete(id: number) {
    setRowError(null);
    try {
      await suppliersApi.deleteSupplier(id);
      refresh();
    } catch (err) {
      setRowError(te(err));
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="font-heading text-xl font-semibold">{t("suppliers.title")}</h2>
        <div className="flex items-center gap-4">
          <Label className="flex items-center gap-2 font-normal">
            <Checkbox
              checked={includeInactive}
              onCheckedChange={(checked) => setIncludeInactive(checked === true)}
            />
            {t("common.showInactive")}
          </Label>
          <Button type="button" onClick={() => setPanel({ mode: "create" })}>
            {t("suppliers.addSupplier")}
          </Button>
        </div>
      </div>

      {rowError && <p className="text-sm font-medium text-destructive">{rowError}</p>}
      {loadError && <p className="text-sm font-medium text-destructive">{loadError}</p>}

      {panel.mode === "create" && (
        <Card>
          <CardHeader>
            <CardTitle>{t("suppliers.addSupplier")}</CardTitle>
          </CardHeader>
          <CardContent>
            <SupplierForm onSubmit={handleCreate} onCancel={() => setPanel({ mode: "closed" })} />
          </CardContent>
        </Card>
      )}

      {panel.mode === "edit" && (
        <Card>
          <CardHeader>
            <CardTitle>{t("suppliers.editSupplier")}</CardTitle>
          </CardHeader>
          <CardContent>
            <SupplierForm
              initial={panel.supplier}
              onSubmit={(input) => handleUpdate(panel.supplier.id, input)}
              onCancel={() => setPanel({ mode: "closed" })}
            />
          </CardContent>
        </Card>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : suppliers.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("suppliers.empty")}</p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.name")}</TableHead>
                <TableHead>{t("suppliers.contactPerson")}</TableHead>
                <TableHead>{t("suppliers.phone")}</TableHead>
                <TableHead>{t("suppliers.email")}</TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead>{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {suppliers.map((supplier) => (
                <TableRow key={supplier.id}>
                  <TableCell className="font-medium">{supplier.name}</TableCell>
                  <TableCell>{supplier.contact_person ?? "—"}</TableCell>
                  <TableCell>{supplier.phone ?? "—"}</TableCell>
                  <TableCell>{supplier.email ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={supplier.is_active ? "default" : "secondary"}>
                      {supplier.is_active ? t("common.active") : t("common.archived")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setPanel({ mode: "edit", supplier })}
                      >
                        {t("common.edit")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleArchiveToggle(supplier)}
                      >
                        {supplier.is_active ? t("common.archive") : t("common.reactivate")}
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
                              {t("common.deleteConfirmTitle").replace("{name}", supplier.name)}
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              {t("suppliers.deleteConfirmBody")} {t("common.deleteCannotBeUndone")}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                            <AlertDialogAction
                              variant="destructive"
                              onClick={() => handleDelete(supplier.id)}
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
