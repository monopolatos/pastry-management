import { useState } from "react";
import type { FormEvent } from "react";
import { toAppError } from "../../api/errors";
import { BASE_UNIT_CODES, UNIT_KINDS, UNIT_LABELS } from "../../api/types";
import type { Category, RawMaterial, RawMaterialInput, Supplier } from "../../api/types";
import { useFormError } from "../../hooks/useFormError";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";

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
  categories: Category[];
  /** Creates a new category (used by the inline "+ Add new category" option below) and returns
   * it, so the caller's category list refreshes and this form can select it immediately. */
  onCreateCategory: (name: string) => Promise<Category>;
  onSubmit: (
    input: RawMaterialInput,
    initialPurchase: InitialPurchaseInput | null,
  ) => Promise<void>;
  onCancel: () => void;
}

const KNOWN_FIELDS = ["name", "base_unit_code", "default_supplier_id", "category_id"] as const;
const ADD_NEW_CATEGORY_VALUE = "__add_new_category__";

/**
 * The pricing strategy field exists in the schema (docs/database-schema.md) for the costing engine
 * landing in Phase 4, but until that engine actually consumes it, exposing a choice with no
 * visible effect just confuses the create form. Every material is created with the "latest
 * purchase price" default; a strategy picker can return once changing it actually does something.
 */
const DEFAULT_PRICING_STRATEGY = "latest";

const NONE_VALUE = "__none__";

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
  onCreateCategory,
  onSubmit,
  onCancel,
}: RawMaterialFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [categoryId, setCategoryId] = useState<string>(
    initial?.category_id != null ? String(initial.category_id) : "",
  );
  const [showNewCategoryInput, setShowNewCategoryInput] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [newCategoryError, setNewCategoryError] = useState<string | null>(null);
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

  function handleCategorySelectChange(value: string) {
    if (value === ADD_NEW_CATEGORY_VALUE) {
      setShowNewCategoryInput(true);
      return;
    }
    setCategoryId(value === NONE_VALUE ? "" : value);
  }

  async function handleCreateCategory() {
    if (newCategoryName.trim() === "") return;
    setCreatingCategory(true);
    setNewCategoryError(null);
    try {
      const created = await onCreateCategory(newCategoryName.trim());
      setCategoryId(String(created.id));
      setNewCategoryName("");
      setShowNewCategoryInput(false);
    } catch (err) {
      setNewCategoryError(toAppError(err).message);
    } finally {
      setCreatingCategory(false);
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
          category_id: categoryId === "" ? null : Number(categoryId),
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
    <form className="flex max-w-xl flex-col gap-4" onSubmit={handleSubmit}>
      {formError.general && (
        <p className="text-sm font-medium text-destructive">{formError.general}</p>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="material-name">Name</Label>
        <Input
          id="material-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        {formError.fieldError("name") && (
          <p className="text-sm text-destructive">{formError.fieldError("name")}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="material-description">Description</Label>
        <Textarea
          id="material-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="material-category">Category</Label>
        <Select
          value={categoryId === "" ? NONE_VALUE : categoryId}
          onValueChange={handleCategorySelectChange}
        >
          <SelectTrigger id="material-category" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_VALUE}>(none)</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.name}
              </SelectItem>
            ))}
            <SelectItem value={ADD_NEW_CATEGORY_VALUE}>+ Add new category…</SelectItem>
          </SelectContent>
        </Select>
        {formError.fieldError("category_id") && (
          <p className="text-sm text-destructive">{formError.fieldError("category_id")}</p>
        )}

        {showNewCategoryInput && (
          <div className="flex items-end gap-2 rounded-lg border p-2">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="material-new-category">New category name</Label>
              <Input
                id="material-new-category"
                type="text"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                autoFocus
              />
              {newCategoryError && <p className="text-sm text-destructive">{newCategoryError}</p>}
            </div>
            <Button
              type="button"
              size="sm"
              onClick={handleCreateCategory}
              disabled={creatingCategory}
            >
              {creatingCategory ? "Adding…" : "Add"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setShowNewCategoryInput(false)}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="material-base-unit">Base unit</Label>
        <Select value={baseUnitCode} onValueChange={handleBaseUnitChange}>
          <SelectTrigger id="material-base-unit" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BASE_UNIT_CODES.map((code) => (
              <SelectItem key={code} value={code}>
                {UNIT_LABELS[code]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {formError.fieldError("base_unit_code") && (
          <p className="text-sm text-destructive">{formError.fieldError("base_unit_code")}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="material-default-supplier">Default supplier</Label>
        <Select
          value={defaultSupplierId === "" ? NONE_VALUE : defaultSupplierId}
          onValueChange={(value) => setDefaultSupplierId(value === NONE_VALUE ? "" : value)}
        >
          <SelectTrigger id="material-default-supplier" className="w-full">
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
        {formError.fieldError("default_supplier_id") && (
          <p className="text-sm text-destructive">{formError.fieldError("default_supplier_id")}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="material-notes">Notes</Label>
        <Textarea id="material-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      {isCreate && (
        <fieldset className="flex flex-col gap-3 rounded-lg border p-4">
          <legend className="px-1 text-sm font-semibold">
            Set a starting price{" "}
            <span className="font-normal text-muted-foreground">
              (optional — you can add this later)
            </span>
          </legend>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="material-purchase-supplier">
              Supplier <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Select
              value={purchaseSupplierId === "" ? NONE_VALUE : purchaseSupplierId}
              onValueChange={(value) => setPurchaseSupplierId(value === NONE_VALUE ? "" : value)}
            >
              <SelectTrigger id="material-purchase-supplier" className="w-full">
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
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="material-purchase-date">Purchase date</Label>
            <Input
              id="material-purchase-date"
              type="date"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="material-purchase-quantity">Quantity</Label>
            <Input
              id="material-purchase-quantity"
              type="number"
              step="any"
              min="0"
              value={purchaseQuantity}
              onChange={(e) => setPurchaseQuantity(e.target.value)}
            />
            {formError.fieldError("purchase_quantity") && (
              <p className="text-sm text-destructive">
                {formError.fieldError("purchase_quantity")}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="material-purchase-unit">Purchase unit</Label>
            <Select value={purchaseUnitCode} onValueChange={setPurchaseUnitCode}>
              <SelectTrigger id="material-purchase-unit" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {compatiblePurchaseUnits.map((code) => (
                  <SelectItem key={code} value={code}>
                    {UNIT_LABELS[code]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="material-purchase-total-price">Total price paid (€)</Label>
            <Input
              id="material-purchase-total-price"
              type="number"
              step="0.01"
              min="0"
              value={purchaseTotalPrice}
              onChange={(e) => setPurchaseTotalPrice(e.target.value)}
            />
            {formError.fieldError("purchase_total_price") && (
              <p className="text-sm text-destructive">
                {formError.fieldError("purchase_total_price")}
              </p>
            )}
          </div>
        </fieldset>
      )}

      <div className="flex gap-3">
        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : initial ? "Save changes" : "Add raw material"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
