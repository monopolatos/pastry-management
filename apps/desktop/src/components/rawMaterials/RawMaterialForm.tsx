import { useState } from "react";
import type { FormEvent } from "react";
import { BASE_UNIT_CODES, UNIT_KINDS, UNIT_LABELS } from "../../api/types";
import type { RawMaterial, RawMaterialInput, Supplier } from "../../api/types";
import { useFormError } from "../../hooks/useFormError";

/** An optional first purchase to record in the same step as creating the material, so a price can
 * be set immediately instead of requiring a second trip to the material's detail page. */
export interface InitialPurchaseInput {
  supplier_id: number | null;
  purchase_date: string;
  quantity: number;
  purchase_unit_code: string;
  total_price_micros: number;
}

interface RawMaterialFormProps {
  initial?: RawMaterial;
  suppliers: Supplier[];
  /** Existing category values across all materials, offered as a picker (see `<datalist>` below)
   * so categories stay consistent without needing a separate categories table/CRUD screen. */
  categories: string[];
  onSubmit: (
    input: RawMaterialInput,
    initialPurchase: InitialPurchaseInput | null,
  ) => Promise<void>;
  onCancel: () => void;
}

const KNOWN_FIELDS = ["name", "base_unit_code", "default_supplier_id"] as const;

/**
 * The pricing strategy field exists in the schema (docs/database-schema.md) for the costing engine
 * landing in Phase 4, but until that engine actually consumes it, exposing a choice with no
 * visible effect just confuses the create form. Every material is created with the "latest
 * purchase price" default; a strategy picker can return once changing it actually does something.
 */
const DEFAULT_PRICING_STRATEGY = "latest";

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function RawMaterialForm({
  initial,
  suppliers,
  categories,
  onSubmit,
  onCancel,
}: RawMaterialFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [baseUnitCode, setBaseUnitCode] = useState(initial?.base_unit_code ?? BASE_UNIT_CODES[0]);
  const [defaultSupplierId, setDefaultSupplierId] = useState<string>(
    initial?.default_supplier_id != null ? String(initial.default_supplier_id) : "",
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");

  // Initial-purchase fields — create mode only (see isCreate below). Left blank, no purchase is
  // recorded; the material can still be given its first price later from its detail page.
  const [purchaseSupplierId, setPurchaseSupplierId] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(today());
  const [purchaseQuantity, setPurchaseQuantity] = useState("");
  const [purchaseUnitCode, setPurchaseUnitCode] = useState<string>(baseUnitCode);
  const [purchaseTotalPrice, setPurchaseTotalPrice] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const formError = useFormError();

  const isCreate = !initial;
  const materialKind = UNIT_KINDS[baseUnitCode as (typeof BASE_UNIT_CODES)[number]];
  const compatiblePurchaseUnits = materialKind
    ? BASE_UNIT_CODES.filter((code) => UNIT_KINDS[code] === materialKind)
    : BASE_UNIT_CODES;

  function handleBaseUnitChange(code: string) {
    setBaseUnitCode(code);
    const kind = UNIT_KINDS[code as (typeof BASE_UNIT_CODES)[number]];
    if (kind && UNIT_KINDS[purchaseUnitCode as (typeof BASE_UNIT_CODES)[number]] !== kind) {
      setPurchaseUnitCode(code);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    formError.clear();

    if (name.trim() === "") {
      formError.handle({ message: "Raw material name is required.", field: "name" }, ["name"]);
      return;
    }

    const wantsInitialPurchase = purchaseQuantity.trim() !== "" || purchaseTotalPrice.trim() !== "";
    let initialPurchase: InitialPurchaseInput | null = null;
    if (isCreate && wantsInitialPurchase) {
      const quantityNumber = parseFloat(purchaseQuantity);
      if (!Number.isFinite(quantityNumber) || quantityNumber <= 0) {
        formError.handle(
          { message: "Quantity must be greater than zero.", field: "purchase_quantity" },
          ["purchase_quantity"],
        );
        return;
      }
      const totalPriceNumber = parseFloat(purchaseTotalPrice);
      if (!Number.isFinite(totalPriceNumber) || totalPriceNumber < 0) {
        formError.handle({ message: "Enter a valid total price.", field: "purchase_total_price" }, [
          "purchase_total_price",
        ]);
        return;
      }
      initialPurchase = {
        supplier_id: purchaseSupplierId === "" ? null : Number(purchaseSupplierId),
        purchase_date: purchaseDate,
        quantity: quantityNumber,
        purchase_unit_code: purchaseUnitCode,
        total_price_micros: Math.round(totalPriceNumber * 1_000_000),
      };
    }

    setSubmitting(true);
    try {
      await onSubmit(
        {
          name: name.trim(),
          description: emptyToNull(description),
          category: emptyToNull(category),
          base_unit_code: baseUnitCode,
          default_supplier_id: defaultSupplierId === "" ? null : Number(defaultSupplierId),
          pricing_strategy: initial?.pricing_strategy ?? DEFAULT_PRICING_STRATEGY,
          pricing_strategy_config: initial?.pricing_strategy_config ?? null,
          notes: emptyToNull(notes),
        },
        initialPurchase,
      );
    } catch (err) {
      formError.handle(err, KNOWN_FIELDS);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="stacked-form" onSubmit={handleSubmit}>
      {formError.general && <p className="form-error">{formError.general}</p>}

      <label htmlFor="material-name">Name</label>
      <input
        id="material-name"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      {formError.fieldError("name") && (
        <p className="field-error">{formError.fieldError("name")}</p>
      )}

      <label htmlFor="material-description">Description</label>
      <textarea
        id="material-description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      <label htmlFor="material-category">Category</label>
      <input
        id="material-category"
        type="text"
        list="material-category-options"
        placeholder="e.g. Dry goods, Dairy, Fruit…"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
      />
      <datalist id="material-category-options">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <p className="hint">Pick an existing category or type a new one.</p>

      <label htmlFor="material-base-unit">Base unit</label>
      <select
        id="material-base-unit"
        value={baseUnitCode}
        onChange={(e) => handleBaseUnitChange(e.target.value)}
      >
        {BASE_UNIT_CODES.map((code) => (
          <option key={code} value={code}>
            {UNIT_LABELS[code]}
          </option>
        ))}
      </select>
      {formError.fieldError("base_unit_code") && (
        <p className="field-error">{formError.fieldError("base_unit_code")}</p>
      )}

      <label htmlFor="material-default-supplier">Default supplier</label>
      <select
        id="material-default-supplier"
        value={defaultSupplierId}
        onChange={(e) => setDefaultSupplierId(e.target.value)}
      >
        <option value="">(none)</option>
        {suppliers.map((supplier) => (
          <option key={supplier.id} value={supplier.id}>
            {supplier.name}
          </option>
        ))}
      </select>
      {formError.fieldError("default_supplier_id") && (
        <p className="field-error">{formError.fieldError("default_supplier_id")}</p>
      )}

      <label htmlFor="material-notes">Notes</label>
      <textarea id="material-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />

      {isCreate && (
        <fieldset className="inline-fieldset">
          <legend>
            Set a starting price <span className="hint">(optional — you can add this later)</span>
          </legend>

          <label htmlFor="material-purchase-supplier">
            Supplier <span className="hint">(optional)</span>
          </label>
          <select
            id="material-purchase-supplier"
            value={purchaseSupplierId}
            onChange={(e) => setPurchaseSupplierId(e.target.value)}
          >
            <option value="">(none)</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>

          <label htmlFor="material-purchase-date">Purchase date</label>
          <input
            id="material-purchase-date"
            type="date"
            value={purchaseDate}
            onChange={(e) => setPurchaseDate(e.target.value)}
          />

          <label htmlFor="material-purchase-quantity">Quantity</label>
          <input
            id="material-purchase-quantity"
            type="number"
            step="any"
            min="0"
            value={purchaseQuantity}
            onChange={(e) => setPurchaseQuantity(e.target.value)}
          />
          {formError.fieldError("purchase_quantity") && (
            <p className="field-error">{formError.fieldError("purchase_quantity")}</p>
          )}

          <label htmlFor="material-purchase-unit">Purchase unit</label>
          <select
            id="material-purchase-unit"
            value={purchaseUnitCode}
            onChange={(e) => setPurchaseUnitCode(e.target.value)}
          >
            {compatiblePurchaseUnits.map((code) => (
              <option key={code} value={code}>
                {UNIT_LABELS[code]}
              </option>
            ))}
          </select>

          <label htmlFor="material-purchase-total-price">Total price paid (€)</label>
          <input
            id="material-purchase-total-price"
            type="number"
            step="0.01"
            min="0"
            value={purchaseTotalPrice}
            onChange={(e) => setPurchaseTotalPrice(e.target.value)}
          />
          {formError.fieldError("purchase_total_price") && (
            <p className="field-error">{formError.fieldError("purchase_total_price")}</p>
          )}
        </fieldset>
      )}

      <div className="form-actions">
        <button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : initial ? "Save changes" : "Add raw material"}
        </button>
        <button type="button" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
      </div>
    </form>
  );
}
