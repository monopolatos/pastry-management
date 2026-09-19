import { useCallback, useEffect, useState } from "react";
import * as suppliersApi from "../../api/suppliers";
import { toAppError } from "../../api/errors";
import type { Supplier, SupplierInput } from "../../api/types";
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
      .catch((err) => setLoadError(toAppError(err).message))
      .finally(() => setLoading(false));
  }, [includeInactive]);

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
      setRowError(toAppError(err).message);
    }
  }

  async function handleDelete(id: number) {
    setRowError(null);
    try {
      await suppliersApi.deleteSupplier(id);
      refresh();
    } catch (err) {
      setRowError(toAppError(err).message);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="font-heading text-xl font-semibold">Suppliers</h2>
        <div className="flex items-center gap-4">
          <Label className="flex items-center gap-2 font-normal">
            <Checkbox
              checked={includeInactive}
              onCheckedChange={(checked) => setIncludeInactive(checked === true)}
            />
            Show inactive
          </Label>
          <Button type="button" onClick={() => setPanel({ mode: "create" })}>
            Add supplier
          </Button>
        </div>
      </div>

      {rowError && <p className="text-sm font-medium text-destructive">{rowError}</p>}
      {loadError && <p className="text-sm font-medium text-destructive">{loadError}</p>}

      {panel.mode === "create" && (
        <Card>
          <CardHeader>
            <CardTitle>Add supplier</CardTitle>
          </CardHeader>
          <CardContent>
            <SupplierForm onSubmit={handleCreate} onCancel={() => setPanel({ mode: "closed" })} />
          </CardContent>
        </Card>
      )}

      {panel.mode === "edit" && (
        <Card>
          <CardHeader>
            <CardTitle>Edit supplier</CardTitle>
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
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : suppliers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No suppliers yet.</p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Contact person</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
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
                      {supplier.is_active ? "Active" : "Archived"}
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
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleArchiveToggle(supplier)}
                      >
                        {supplier.is_active ? "Archive" : "Reactivate"}
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button type="button" variant="destructive" size="sm">
                            Delete
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete "{supplier.name}"?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This permanently deletes the supplier. This cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              variant="destructive"
                              onClick={() => handleDelete(supplier.id)}
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
