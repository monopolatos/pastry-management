import { useState } from "react";
import type { FormEvent } from "react";
import type { Supplier, SupplierInput } from "../../api/types";
import { useFormError } from "../../hooks/useFormError";

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
    <form className="stacked-form" onSubmit={handleSubmit}>
      {formError.general && <p className="form-error">{formError.general}</p>}

      <label htmlFor="supplier-name">Name</label>
      <input
        id="supplier-name"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      {formError.fieldError("name") && (
        <p className="field-error">{formError.fieldError("name")}</p>
      )}

      <label htmlFor="supplier-contact-person">Contact person</label>
      <input
        id="supplier-contact-person"
        type="text"
        value={contactPerson}
        onChange={(e) => setContactPerson(e.target.value)}
      />

      <label htmlFor="supplier-phone">Phone</label>
      <input
        id="supplier-phone"
        type="text"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
      />

      <label htmlFor="supplier-email">Email</label>
      <input
        id="supplier-email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      {formError.fieldError("email") && (
        <p className="field-error">{formError.fieldError("email")}</p>
      )}

      <label htmlFor="supplier-address">Address</label>
      <textarea
        id="supplier-address"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
      />

      <label htmlFor="supplier-vat">VAT number</label>
      <input
        id="supplier-vat"
        type="text"
        value={vatNumber}
        onChange={(e) => setVatNumber(e.target.value)}
      />

      <label htmlFor="supplier-notes">Notes</label>
      <textarea id="supplier-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />

      <div className="form-actions">
        <button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : initial ? "Save changes" : "Add supplier"}
        </button>
        <button type="button" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
      </div>
    </form>
  );
}
