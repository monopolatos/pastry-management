import { useCallback, useEffect, useState } from "react";
import { toAppError } from "../../api/errors";
import { listPurchaseRecordsForMaterial } from "../../api/purchaseRecords";
import { UNIT_LABELS } from "../../api/types";
import type { BaseUnitCode, PurchaseRecord, RawMaterial, Supplier } from "../../api/types";
import { PurchaseRecordForm } from "./PurchaseRecordForm";

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
    <section>
      <button type="button" onClick={onBack}>
        ← Back to raw materials
      </button>

      <h2>{material.name}</h2>

      {justCreated && (
        <p className="callout">
          "{material.name}" was created. It has no price yet — record its first purchase below to
          set one.
        </p>
      )}

      <dl className="detail-summary">
        <dt>Category</dt>
        <dd>{material.category ?? "—"}</dd>
        <dt>Base unit</dt>
        <dd>{unitLabel(material.base_unit_code)}</dd>
        <dt>Status</dt>
        <dd>{material.is_active ? "Active" : "Archived"}</dd>
      </dl>

      <h3>Purchase history</h3>
      {loadError && <p className="form-error">{loadError}</p>}
      {loading ? (
        <p>Loading…</p>
      ) : history.length === 0 ? (
        <p>No purchases recorded yet.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Supplier</th>
              <th>Quantity</th>
              <th>Total price</th>
              <th>Cost per {unitLabel(material.base_unit_code)}</th>
            </tr>
          </thead>
          <tbody>
            {history.map((record) => (
              <tr key={record.id}>
                <td>{record.purchase_date}</td>
                <td>{supplierName(record.supplier_id)}</td>
                <td>
                  {record.quantity} {unitLabel(record.purchase_unit_code)}
                </td>
                <td>€{formatMoney(record.total_price_micros, 2)}</td>
                <td>€{formatMoney(record.cost_per_base_unit_micros, 4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>Record new purchase</h3>
      <PurchaseRecordForm rawMaterial={material} suppliers={activeSuppliers} onCreated={refresh} />
    </section>
  );
}
