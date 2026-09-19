import { useState } from "react";
import type { FormEvent } from "react";
import { createPurchaseRecord } from "../../api/purchaseRecords";
import { BASE_UNIT_CODES, UNIT_KINDS, UNIT_LABELS } from "../../api/types";
import type { RawMaterial, Supplier } from "../../api/types";
import { useFormError } from "../../hooks/useFormError";

interface PurchaseRecordFormProps {
  rawMaterial: RawMaterial;
  suppliers: Supplier[];
  onCreated: () => void;
}

const KNOWN_FIELDS = [
  "raw_material_id",
  "supplier_id",
  "purchase_date",
  "quantity",
  "purchase_unit_code",
  "total_price_micros",
  "expiration_date",
] as const;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function PurchaseRecordForm({ rawMaterial, suppliers, onCreated }: PurchaseRecordFormProps) {
  // Filter the unit dropdown to units of the same kind (weight/volume/count) as the material's
  // base unit for a nicer UX — the backend is still the source of truth and rejects a mismatch
  // with a clear field error regardless.
  const materialKind = UNIT_KINDS[rawMaterial.base_unit_code as (typeof BASE_UNIT_CODES)[number]];
  const compatibleUnits = materialKind
    ? BASE_UNIT_CODES.filter((code) => UNIT_KINDS[code] === materialKind)
    : BASE_UNIT_CODES;

  const [supplierId, setSupplierId] = useState<string>("");
  const [purchaseDate, setPurchaseDate] = useState(today());
  const [quantity, setQuantity] = useState("");
  const [purchaseUnitCode, setPurchaseUnitCode] = useState<string>(
    compatibleUnits[0] ?? rawMaterial.base_unit_code,
  );
  const [totalPrice, setTotalPrice] = useState("");
  const [expirationDate, setExpirationDate] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const formError = useFormError();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    formError.clear();

    const quantityNumber = parseFloat(quantity);
    if (!Number.isFinite(quantityNumber) || quantityNumber <= 0) {
      formError.handle({ message: "Quantity must be greater than zero.", field: "quantity" }, [
        "quantity",
      ]);
      return;
    }
    const totalPriceNumber = parseFloat(totalPrice);
    if (!Number.isFinite(totalPriceNumber) || totalPriceNumber < 0) {
      formError.handle({ message: "Enter a valid total price.", field: "total_price_micros" }, [
        "total_price_micros",
      ]);
      return;
    }

    setSubmitting(true);
    try {
      await createPurchaseRecord({
        raw_material_id: rawMaterial.id,
        supplier_id: supplierId === "" ? null : Number(supplierId),
        purchase_date: purchaseDate,
        quantity: quantityNumber,
        purchase_unit_code: purchaseUnitCode,
        total_price_micros: Math.round(totalPriceNumber * 1_000_000),
        expiration_date: expirationDate === "" ? null : expirationDate,
        notes: notes.trim() === "" ? null : notes.trim(),
      });
      setQuantity("");
      setTotalPrice("");
      setExpirationDate("");
      setNotes("");
      onCreated();
    } catch (err) {
      formError.handle(err, KNOWN_FIELDS);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="stacked-form" onSubmit={handleSubmit}>
      {formError.general && <p className="form-error">{formError.general}</p>}

      <label htmlFor="purchase-supplier">
        Supplier <span className="hint">(optional)</span>
      </label>
      <select
        id="purchase-supplier"
        value={supplierId}
        onChange={(e) => setSupplierId(e.target.value)}
      >
        <option value="">(none)</option>
        {suppliers.map((supplier) => (
          <option key={supplier.id} value={supplier.id}>
            {supplier.name}
          </option>
        ))}
      </select>
      {formError.fieldError("supplier_id") && (
        <p className="field-error">{formError.fieldError("supplier_id")}</p>
      )}

      <label htmlFor="purchase-date">Purchase date</label>
      <input
        id="purchase-date"
        type="date"
        value={purchaseDate}
        onChange={(e) => setPurchaseDate(e.target.value)}
        required
      />
      {formError.fieldError("purchase_date") && (
        <p className="field-error">{formError.fieldError("purchase_date")}</p>
      )}

      <label htmlFor="purchase-quantity">Quantity</label>
      <input
        id="purchase-quantity"
        type="number"
        step="any"
        min="0"
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        required
      />
      {formError.fieldError("quantity") && (
        <p className="field-error">{formError.fieldError("quantity")}</p>
      )}

      <label htmlFor="purchase-unit">Purchase unit</label>
      <select
        id="purchase-unit"
        value={purchaseUnitCode}
        onChange={(e) => setPurchaseUnitCode(e.target.value)}
      >
        {compatibleUnits.map((code) => (
          <option key={code} value={code}>
            {UNIT_LABELS[code]}
          </option>
        ))}
      </select>
      {formError.fieldError("purchase_unit_code") && (
        <p className="field-error">{formError.fieldError("purchase_unit_code")}</p>
      )}

      <label htmlFor="purchase-total-price">Total price paid (€)</label>
      <input
        id="purchase-total-price"
        type="number"
        step="0.01"
        min="0"
        value={totalPrice}
        onChange={(e) => setTotalPrice(e.target.value)}
        required
      />
      {formError.fieldError("total_price_micros") && (
        <p className="field-error">{formError.fieldError("total_price_micros")}</p>
      )}

      <label htmlFor="purchase-expiration">
        Expiration date <span className="hint">(optional)</span>
      </label>
      <input
        id="purchase-expiration"
        type="date"
        value={expirationDate}
        onChange={(e) => setExpirationDate(e.target.value)}
      />
      {formError.fieldError("expiration_date") && (
        <p className="field-error">{formError.fieldError("expiration_date")}</p>
      )}

      <label htmlFor="purchase-notes">
        Notes <span className="hint">(optional)</span>
      </label>
      <textarea id="purchase-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />

      <div className="form-actions">
        <button type="submit" disabled={submitting}>
          {submitting ? "Recording…" : "Record purchase"}
        </button>
      </div>
    </form>
  );
}
