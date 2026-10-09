import { useState } from "react";
import type { FormEvent } from "react";
import type { Category } from "../../api/types";
import { useFormError } from "../../hooks/useFormError";
import { useI18n } from "../../lib/i18n";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";

export interface FinanceEntryValues {
  date: string;
  category_id: number | null;
  amount_micros: number;
  description: string | null;
}

interface FinanceEntryFormProps {
  /** Normalized so this one form works for both Expense (`expense_date`) and IncomeEntry
   * (`income_date`) — the caller maps its own field names to/from this shape. */
  initial?: FinanceEntryValues;
  categories: Category[];
  onSubmit: (values: FinanceEntryValues) => Promise<void>;
  onCancel: () => void;
}

const KNOWN_FIELDS = ["expense_date", "income_date", "category_id", "amount_micros"] as const;
const NONE_VALUE = "__none__";

function today(): string {
  return new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local date, no timezone surprises
}

/** Shared add/edit form for a single expense or income entry — the two are structurally
 * identical (date, category, amount, description), so one form serves both, with the caller
 * supplying the right category list and submit handler. */
export function FinanceEntryForm({
  initial,
  categories,
  onSubmit,
  onCancel,
}: FinanceEntryFormProps) {
  const { t } = useI18n();
  const [date, setDate] = useState(initial?.date ?? today());
  const [categoryId, setCategoryId] = useState(
    initial?.category_id != null ? String(initial.category_id) : "",
  );
  const [amount, setAmount] = useState(
    initial ? (initial.amount_micros / 1_000_000).toFixed(2) : "",
  );
  const [description, setDescription] = useState(initial?.description ?? "");
  const [submitting, setSubmitting] = useState(false);
  const formError = useFormError();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    formError.clear();

    if (date.trim() === "") {
      formError.handle({ message: "Date is required.", field: "expense_date" }, [
        "expense_date",
        "income_date",
      ]);
      return;
    }
    const amountNumber = parseFloat(amount);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      formError.handle({ message: "Amount must be greater than zero.", field: "amount_micros" }, [
        "amount_micros",
      ]);
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        date,
        category_id: categoryId === "" ? null : Number(categoryId),
        amount_micros: Math.round(amountNumber * 1_000_000),
        description: description.trim() === "" ? null : description.trim(),
      });
    } catch (err) {
      formError.handle(err, KNOWN_FIELDS);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="flex max-w-lg flex-col gap-4" onSubmit={handleSubmit}>
      {formError.general && (
        <p className="text-sm font-medium text-destructive">{formError.general}</p>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="finance-entry-date">{t("common.date")}</Label>
          <Input
            id="finance-entry-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
          {(formError.fieldError("expense_date") || formError.fieldError("income_date")) && (
            <p className="text-sm text-destructive">
              {formError.fieldError("expense_date") ?? formError.fieldError("income_date")}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="finance-entry-amount">{t("finance.amount")}</Label>
          <Input
            id="finance-entry-amount"
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
          {formError.fieldError("amount_micros") && (
            <p className="text-sm text-destructive">{formError.fieldError("amount_micros")}</p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="finance-entry-category">{t("common.category")}</Label>
        <Select
          value={categoryId === "" ? NONE_VALUE : categoryId}
          onValueChange={(value) => setCategoryId(value === NONE_VALUE ? "" : value)}
        >
          <SelectTrigger id="finance-entry-category" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_VALUE}>{t("common.none")}</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="finance-entry-description">{t("common.description")}</Label>
        <Textarea
          id="finance-entry-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="flex gap-3">
        <Button type="submit" disabled={submitting}>
          {submitting ? t("common.saving") : initial ? t("common.saveChanges") : t("common.add")}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
