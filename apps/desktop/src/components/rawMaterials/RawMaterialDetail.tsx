import { useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { listPurchaseRecordsForMaterial } from "../../api/purchaseRecords";
import { UNIT_LABEL_KEYS } from "../../api/types";
import type {
  BaseUnitCode,
  Category,
  PurchaseRecord,
  RawMaterial,
  Supplier,
} from "../../api/types";
import { useI18n } from "../../lib/i18n";
import { PurchaseRecordForm } from "./PurchaseRecordForm";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

interface RawMaterialDetailProps {
  material: RawMaterial;
  suppliers: Supplier[];
  categories: Category[];
  /** True right after this material was just created, so we can point the user at the purchase
   * form below — a raw material has no price of its own until a purchase is recorded. */
  justCreated?: boolean;
  onBack: () => void;
}

function formatMoney(micros: number, digits: number): string {
  return (micros / 1_000_000).toFixed(digits);
}

export function RawMaterialDetail({
  material,
  suppliers,
  categories,
  justCreated = false,
  onBack,
}: RawMaterialDetailProps) {
  const { t, te } = useI18n();
  const [history, setHistory] = useState<PurchaseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const unitLabel = useCallback(
    (code: string): string => {
      const key = UNIT_LABEL_KEYS[code as BaseUnitCode];
      return key ? t(key) : code;
    },
    [t],
  );

  const supplierName = useCallback(
    (supplierId: number | null): string => {
      if (supplierId === null) return "—";
      return suppliers.find((s) => s.id === supplierId)?.name ?? `Supplier #${supplierId}`;
    },
    [suppliers],
  );

  const categoryName = useCallback(
    (categoryId: number | null): string => {
      if (categoryId === null) return "—";
      return categories.find((c) => c.id === categoryId)?.name ?? `Category #${categoryId}`;
    },
    [categories],
  );

  const refresh = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    listPurchaseRecordsForMaterial(material.id)
      .then(setHistory)
      .catch((err) => setLoadError(te(err)))
      .finally(() => setLoading(false));
  }, [material.id, te]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const activeSuppliers = suppliers.filter((s) => s.is_active);

  return (
    <section className="flex flex-col gap-6">
      <div>
        <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={onBack}>
          <ArrowLeft className="size-4" />
          {t("rawMaterials.backToList")}
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <h2 className="font-heading text-xl font-semibold">{material.name}</h2>
        <Badge variant={material.is_active ? "success" : "destructive"}>
          {material.is_active ? t("common.active") : t("common.archived")}
        </Badge>
      </div>

      {justCreated && (
        <div className="rounded-lg border-l-4 border-l-primary bg-muted/50 px-4 py-3 text-sm">
          {t("rawMaterials.justCreatedNotice").replace("{name}", material.name)}
        </div>
      )}

      <Card>
        <CardContent>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="font-medium text-muted-foreground">{t("common.category")}</dt>
            <dd>{categoryName(material.category_id)}</dd>
            <dt className="font-medium text-muted-foreground">{t("rawMaterials.baseUnit")}</dt>
            <dd>{unitLabel(material.base_unit_code)}</dd>
          </dl>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2">
        <h3 className="font-heading text-base font-semibold">
          {t("rawMaterials.purchaseHistory")}
        </h3>
        {loadError && <p className="text-sm font-medium text-destructive">{loadError}</p>}
        {loading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("rawMaterials.noPurchasesYet")}</p>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("common.date")}</TableHead>
                  <TableHead>{t("common.supplier")}</TableHead>
                  <TableHead>{t("common.quantity")}</TableHead>
                  <TableHead>{t("rawMaterials.totalPrice")}</TableHead>
                  <TableHead>
                    {t("rawMaterials.costPer").replace(
                      "{unit}",
                      unitLabel(material.base_unit_code),
                    )}
                  </TableHead>
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
                    <TableCell>€{formatMoney(record.cost_per_base_unit_micros, 2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="font-heading text-base font-semibold">
          {t("rawMaterials.recordNewPurchase")}
        </h3>
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
