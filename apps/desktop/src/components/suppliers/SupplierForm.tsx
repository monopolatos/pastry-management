import { useState } from "react";
import type { FormEvent } from "react";
import type { Supplier, SupplierInput } from "../../api/types";
import { useFormError } from "../../hooks/useFormError";
import { useI18n } from "../../lib/i18n";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";

interface SupplierFormProps {
  initial?: Supplier;
  onSubmit: (input: SupplierInput) => Promise<void>;
  onCancel: () => void;
}

const KNOWN_FIELDS = ["name", "email"] as const;

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function SupplierForm({ initial, onSubmit, onCancel }: SupplierFormProps) {
  const { t } = useI18n();
  const [name, setName] = useState(initial?.name ?? "");
  const [contactPerson, setContactPerson] = useState(initial?.contact_person ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [vatNumber, setVatNumber] = useState(initial?.vat_number ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const formError = useFormError();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    formError.clear();

    if (name.trim() === "") {
      // Literal English text matching the Rust-side message exactly, so useFormError's
      // translateErrorMessage lookup (see src/lib/errorTranslations.ts) translates it the same
      // way it would if the backend had rejected this — one Greek string, not two to keep in sync.
      formError.handle({ message: "Supplier name is required.", field: "name" }, ["name"]);
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        contact_person: emptyToNull(contactPerson),
        phone: emptyToNull(phone),
        email: emptyToNull(email),
        address: emptyToNull(address),
        vat_number: emptyToNull(vatNumber),
        notes: emptyToNull(notes),
      });
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
        <Label htmlFor="supplier-name">{t("common.name")}</Label>
        <Input
          id="supplier-name"
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
        <Label htmlFor="supplier-contact-person">{t("suppliers.contactPerson")}</Label>
        <Input
          id="supplier-contact-person"
          type="text"
          value={contactPerson}
          onChange={(e) => setContactPerson(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="supplier-phone">{t("suppliers.phone")}</Label>
        <Input
          id="supplier-phone"
          type="text"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="supplier-email">{t("suppliers.email")}</Label>
        <Input
          id="supplier-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {formError.fieldError("email") && (
          <p className="text-sm text-destructive">{formError.fieldError("email")}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="supplier-address">{t("suppliers.address")}</Label>
        <Textarea
          id="supplier-address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="supplier-vat">{t("suppliers.vatNumber")}</Label>
        <Input
          id="supplier-vat"
          type="text"
          value={vatNumber}
          onChange={(e) => setVatNumber(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="supplier-notes">{t("common.notes")}</Label>
        <Textarea id="supplier-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div className="flex gap-3">
        <Button type="submit" disabled={submitting}>
          {submitting
            ? t("common.saving")
            : initial
              ? t("common.saveChanges")
              : t("suppliers.addSupplier")}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
