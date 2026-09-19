import { useCallback, useEffect, useState } from "react";
import * as suppliersApi from "../../api/suppliers";
import { toAppError } from "../../api/errors";
import type { Supplier, SupplierInput } from "../../api/types";
import { SupplierForm } from "./SupplierForm";

type Panel = { mode: "closed" } | { mode: "create" } | { mode: "edit"; supplier: Supplier };

export function SuppliersScreen() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>({ mode: "closed" });
  const [rowError, setRowError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    suppliersApi
      .listSuppliers(includeInactive)
      .then(setSuppliers)
      .catch((err) => setLoadError(toAppError(err).message))
      .finally(() => setLoading(false));
  }, [includeInactive]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleCreate(input: SupplierInput) {
    await suppliersApi.createSupplier(input);
    setPanel({ mode: "closed" });
    refresh();
  }

  async function handleUpdate(id: number, input: SupplierInput) {
    await suppliersApi.updateSupplier(id, input);
    setPanel({ mode: "closed" });
    refresh();
  }

  async function handleArchiveToggle(supplier: Supplier) {
    setRowError(null);
    try {
      if (supplier.is_active) {
        await suppliersApi.archiveSupplier(supplier.id);
      } else {
        await suppliersApi.reactivateSupplier(supplier.id);
      }
      refresh();
    } catch (err) {
      setRowError(toAppError(err).message);
    }
  }

  async function handleDelete(id: number) {
    setRowError(null);
    try {
      await suppliersApi.deleteSupplier(id);
      setConfirmDeleteId(null);
      refresh();
    } catch (err) {
      setRowError(toAppError(err).message);
      setConfirmDeleteId(null);
    }
  }

  return (
    <section>
      <div className="screen-header">
        <h2>Suppliers</h2>
        <div className="screen-header-actions">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
            />
            Show inactive
          </label>
          <button type="button" onClick={() => setPanel({ mode: "create" })}>
            Add supplier
          </button>
        </div>
      </div>

      {rowError && <p className="form-error">{rowError}</p>}
      {loadError && <p className="form-error">{loadError}</p>}

      {panel.mode === "create" && (
        <div className="panel">
          <h3>Add supplier</h3>
          <SupplierForm onSubmit={handleCreate} onCancel={() => setPanel({ mode: "closed" })} />
        </div>
      )}

      {panel.mode === "edit" && (
        <div className="panel">
          <h3>Edit supplier</h3>
          <SupplierForm
            initial={panel.supplier}
            onSubmit={(input) => handleUpdate(panel.supplier.id, input)}
            onCancel={() => setPanel({ mode: "closed" })}
          />
        </div>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : suppliers.length === 0 ? (
        <p>No suppliers yet.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Contact person</th>
              <th>Phone</th>
              <th>Email</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map((supplier) => (
              <tr key={supplier.id}>
                <td>{supplier.name}</td>
                <td>{supplier.contact_person ?? "—"}</td>
                <td>{supplier.phone ?? "—"}</td>
                <td>{supplier.email ?? "—"}</td>
                <td>
                  <span className={supplier.is_active ? "badge-active" : "badge-inactive"}>
                    {supplier.is_active ? "Active" : "Archived"}
                  </span>
                </td>
                <td className="row-actions">
                  <button type="button" onClick={() => setPanel({ mode: "edit", supplier })}>
                    Edit
                  </button>
                  <button type="button" onClick={() => handleArchiveToggle(supplier)}>
                    {supplier.is_active ? "Archive" : "Reactivate"}
                  </button>
                  {confirmDeleteId === supplier.id ? (
                    <>
                      <span>Delete permanently?</span>
                      <button type="button" onClick={() => handleDelete(supplier.id)}>
                        Confirm
                      </button>
                      <button type="button" onClick={() => setConfirmDeleteId(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button type="button" onClick={() => setConfirmDeleteId(supplier.id)}>
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
