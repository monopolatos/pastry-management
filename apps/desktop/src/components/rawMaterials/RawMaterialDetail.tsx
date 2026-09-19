import { useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { toAppError } from "../../api/errors";
import { listPurchaseRecordsForMaterial } from "../../api/purchaseRecords";
import { UNIT_LABELS } from "../../api/types";
import type { BaseUnitCode, PurchaseRecord, RawMaterial, Supplier } from "../../api/types";
import { PurchaseRecordForm } from "./PurchaseRecordForm";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

interface RawMaterialDetailProps {
  material: RawMaterial;
  suppliers: Supplier[];
  /** True right after this material was just created, so we can point the user at the purchase
   * form below — a raw material has no price of its own until a purchase is recorded. */
  justCreated?: boolean;
  onBack: () => void;
}

function unitLabel(code: string): string {
  return UNIT_LABELS[code as BaseUnitCode] ?? code;
}

function formatMoney(micros: number, digits: number): string {
  return (micros / 1_000_000).toFixed(digits);
}

export function RawMaterialDetail({
  material,
  suppliers,
  justCreated = false,
  onBack,
}: RawMaterialDetailProps) {
  const [history, setHistory] = useState<PurchaseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const supplierName = useCallback(
    (supplierId: number | null): string => {
      if (supplierId === null) return "—";
      return suppliers.find((s) => s.id === supplierId)?.name ?? `Supplier #${supplierId}`;
    },
    [suppliers],
  );

  const refresh = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    listPurchaseRecordsForMaterial(material.id)
      .then(setHistory)
      .catch((err) => setLoadError(toAppError(err).message))
      .finally(() => setLoading(false));
  }, [material.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const activeSuppliers = suppliers.filter((s) => s.is_active);

  return (
    <section className="flex flex-col gap-6">
      <div>
        <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={onBack}>
          <ArrowLeft className="size-4" />
          Back to raw materials
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <h2 className="font-heading text-xl font-semibold">{material.name}</h2>
        <Badge variant={material.is_active ? "default" : "secondary"}>
          {material.is_active ? "Active" : "Archived"}
        </Badge>
      </div>

      {justCreated && (
        <div className="rounded-lg border-l-4 border-l-primary bg-muted/50 px-4 py-3 text-sm">
          "{material.name}" was created. It has no price yet — record its first purchase below to
          set one.
        </div>
      )}

      <Card>
        <CardContent>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="font-medium text-muted-foreground">Category</dt>
            <dd>{material.category ?? "—"}</dd>
            <dt className="font-medium text-muted-foreground">Base unit</dt>
            <dd>{unitLabel(material.base_unit_code)}</dd>
          </dl>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2">
        <h3 className="font-heading text-base font-semibold">Purchase history</h3>
        {loadError && <p className="text-sm font-medium text-destructive">{loadError}</p>}
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No purchases recorded yet.</p>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Quantity</TableHead>
                  <TableHead>Total price</TableHead>
                  <TableHead>Cost per {unitLabel(material.base_unit_code)}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell>{record.purchase_date}</TableCell>
                    <TableCell>{supplierName(record.supplier_id)}</TableCell>
                    <TableCell>
                      {record.quantity} {unitLabel(record.purchase_unit_code)}
                    </TableCell>
                    <TableCell>€{formatMoney(record.total_price_micros, 2)}</TableCell>
                    <TableCell>€{formatMoney(record.cost_per_base_unit_micros, 4)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="font-heading text-base font-semibold">Record new purchase</h3>
        <Card>
          <CardContent>
            <PurchaseRecordForm
              rawMaterial={material}
              suppliers={activeSuppliers}
              onCreated={refresh}
            />
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
