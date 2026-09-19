import { useState } from "react";
import type { FormEvent } from "react";
import { createPurchaseRecord } from "../../api/purchaseRecords";
import { BASE_UNIT_CODES, UNIT_KINDS, UNIT_LABELS } from "../../api/types";
import type { RawMaterial, Supplier } from "../../api/types";
import { useFormError } from "../../hooks/useFormError";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";

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

const NONE_VALUE = "__none__";

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
    <form className="flex max-w-xl flex-col gap-4" onSubmit={handleSubmit}>
      {formError.general && (
        <p className="text-sm font-medium text-destructive">{formError.general}</p>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="purchase-supplier">
          Supplier <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Select
          value={supplierId === "" ? NONE_VALUE : supplierId}
          onValueChange={(value) => setSupplierId(value === NONE_VALUE ? "" : value)}
        >
          <SelectTrigger id="purchase-supplier" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_VALUE}>(none)</SelectItem>
            {suppliers.map((supplier) => (
              <SelectItem key={supplier.id} value={String(supplier.id)}>
                {supplier.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {formError.fieldError("supplier_id") && (
          <p className="text-sm text-destructive">{formError.fieldError("supplier_id")}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="purchase-date">Purchase date</Label>
        <Input
          id="purchase-date"
          type="date"
          value={purchaseDate}
          onChange={(e) => setPurchaseDate(e.target.value)}
          required
        />
        {formError.fieldError("purchase_date") && (
          <p className="text-sm text-destructive">{formError.fieldError("purchase_date")}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="purchase-quantity">Quantity</Label>
        <Input
          id="purchase-quantity"
          type="number"
          step="any"
          min="0"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          required
        />
        {formError.fieldError("quantity") && (
          <p className="text-sm text-destructive">{formError.fieldError("quantity")}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="purchase-unit">Purchase unit</Label>
        <Select value={purchaseUnitCode} onValueChange={setPurchaseUnitCode}>
          <SelectTrigger id="purchase-unit" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {compatibleUnits.map((code) => (
              <SelectItem key={code} value={code}>
                {UNIT_LABELS[code]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {formError.fieldError("purchase_unit_code") && (
          <p className="text-sm text-destructive">{formError.fieldError("purchase_unit_code")}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="purchase-total-price">Total price paid (€)</Label>
        <Input
          id="purchase-total-price"
          type="number"
          step="0.01"
          min="0"
          value={totalPrice}
          onChange={(e) => setTotalPrice(e.target.value)}
          required
        />
        {formError.fieldError("total_price_micros") && (
          <p className="text-sm text-destructive">{formError.fieldError("total_price_micros")}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="purchase-expiration">
          Expiration date <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="purchase-expiration"
          type="date"
          value={expirationDate}
          onChange={(e) => setExpirationDate(e.target.value)}
        />
        {formError.fieldError("expiration_date") && (
          <p className="text-sm text-destructive">{formError.fieldError("expiration_date")}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="purchase-notes">
          Notes <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Textarea id="purchase-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Recording…" : "Record purchase"}
        </Button>
      </div>
    </form>
  );
}
