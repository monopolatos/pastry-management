import { useCallback, useEffect, useState } from "react";
import { toAppError } from "../../api/errors";
import * as rawMaterialsApi from "../../api/rawMaterials";
import { createPurchaseRecord } from "../../api/purchaseRecords";
import { listSuppliers } from "../../api/suppliers";
import { UNIT_LABELS } from "../../api/types";
import type { BaseUnitCode, RawMaterial, RawMaterialInput, Supplier } from "../../api/types";
import { RawMaterialDetail } from "./RawMaterialDetail";
import { RawMaterialForm } from "./RawMaterialForm";
import type { InitialPurchaseInput } from "./RawMaterialForm";

type Panel = { mode: "closed" } | { mode: "create" } | { mode: "edit"; material: RawMaterial };

function unitLabel(code: string): string {
  return UNIT_LABELS[code as BaseUnitCode] ?? code;
}

export function RawMaterialsScreen() {
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>({ mode: "closed" });
  const [rowError, setRowError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [selectedMaterial, setSelectedMaterial] = useState<RawMaterial | null>(null);
  const [justCreated, setJustCreated] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    Promise.all([
      rawMaterialsApi.listRawMaterials(includeInactive),
      // Include inactive suppliers too, so historical purchase records (which may reference an
      // archived supplier) can still resolve a display name.
      listSuppliers(true),
    ])
      .then(([materialsResult, suppliersResult]) => {
        setMaterials(materialsResult);
        setSuppliers(suppliersResult);
      })
      .catch((err) => setLoadError(toAppError(err).message))
      .finally(() => setLoading(false));
  }, [includeInactive]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleCreate(
    input: RawMaterialInput,
    initialPurchase: InitialPurchaseInput | null,
  ) {
    const created = await rawMaterialsApi.createRawMaterial(input);
    if (initialPurchase) {
      await createPurchaseRecord({
        raw_material_id: created.id,
        expiration_date: null,
        notes: null,
        ...initialPurchase,
      });
    }
    setPanel({ mode: "closed" });
    // Jump straight into the new material's detail view rather than back to the list — if no
    // starting price was given above, recording one is otherwise an easy-to-miss next step.
    setJustCreated(!initialPurchase);
    setSelectedMaterial(created);
    refresh();
  }

  async function handleUpdate(id: number, input: RawMaterialInput) {
    await rawMaterialsApi.updateRawMaterial(id, input);
    setPanel({ mode: "closed" });
    refresh();
  }

  async function handleArchiveToggle(material: RawMaterial) {
    setRowError(null);
    try {
      if (material.is_active) {
        await rawMaterialsApi.archiveRawMaterial(material.id);
      } else {
        await rawMaterialsApi.reactivateRawMaterial(material.id);
      }
      refresh();
    } catch (err) {
      setRowError(toAppError(err).message);
    }
  }

  async function handleDelete(id: number) {
    setRowError(null);
    try {
      await rawMaterialsApi.deleteRawMaterial(id);
      setConfirmDeleteId(null);
      refresh();
    } catch (err) {
      setRowError(toAppError(err).message);
      setConfirmDeleteId(null);
    }
  }

  if (selectedMaterial) {
    return (
      <RawMaterialDetail
        material={selectedMaterial}
        suppliers={suppliers}
        justCreated={justCreated}
        onBack={() => {
          setSelectedMaterial(null);
          setJustCreated(false);
          refresh();
        }}
      />
    );
  }

  const activeSuppliers = suppliers.filter((s) => s.is_active);
  const categories = Array.from(
    new Set(materials.map((m) => m.category).filter((c): c is string => !!c)),
  ).sort((a, b) => a.localeCompare(b));

  return (
    <section>
      <div className="screen-header">
        <h2>Raw Materials</h2>
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
            Add raw material
          </button>
        </div>
      </div>

      {rowError && <p className="form-error">{rowError}</p>}
      {loadError && <p className="form-error">{loadError}</p>}

      {panel.mode === "create" && (
        <div className="panel">
          <h3>Add raw material</h3>
          <RawMaterialForm
            suppliers={activeSuppliers}
            categories={categories}
            onSubmit={handleCreate}
            onCancel={() => setPanel({ mode: "closed" })}
          />
        </div>
      )}

      {panel.mode === "edit" && (
        <div className="panel">
          <h3>Edit raw material</h3>
          <RawMaterialForm
            initial={panel.material}
            suppliers={activeSuppliers}
            categories={categories}
            onSubmit={(input) => handleUpdate(panel.material.id, input)}
            onCancel={() => setPanel({ mode: "closed" })}
          />
        </div>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : materials.length === 0 ? (
        <p>No raw materials yet.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Category</th>
              <th>Base unit</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {materials.map((material) => (
              <tr key={material.id}>
                <td>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => setSelectedMaterial(material)}
                  >
                    {material.name}
                  </button>
                </td>
                <td>{material.category ?? "—"}</td>
                <td>{unitLabel(material.base_unit_code)}</td>
                <td>
                  <span className={material.is_active ? "badge-active" : "badge-inactive"}>
                    {material.is_active ? "Active" : "Archived"}
                  </span>
                </td>
                <td className="row-actions">
                  <button type="button" onClick={() => setPanel({ mode: "edit", material })}>
                    Edit
                  </button>
                  <button type="button" onClick={() => handleArchiveToggle(material)}>
                    {material.is_active ? "Archive" : "Reactivate"}
                  </button>
                  {confirmDeleteId === material.id ? (
                    <>
                      <span>Delete permanently?</span>
                      <button type="button" onClick={() => handleDelete(material.id)}>
                        Confirm
                      </button>
                      <button type="button" onClick={() => setConfirmDeleteId(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button type="button" onClick={() => setConfirmDeleteId(material.id)}>
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
