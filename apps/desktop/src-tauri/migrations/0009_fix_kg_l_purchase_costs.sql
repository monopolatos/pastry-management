-- Migration 0009: backfill purchase_records.cost_per_base_unit_micros for raw materials whose
-- base_unit_code is not the canonical unit for its kind (i.e. "kg" or "l", not "g"/"ml"/"piece").
--
-- A bug in validate_and_compute_cost (see db/repositories/purchase_records.rs, fixed in the same
-- release as this migration) divided the purchased quantity by the PURCHASE unit's canonical
-- conversion factor while never dividing by the MATERIAL's own base-unit conversion factor. Every
-- purchase recorded against a kg-/l-based material was therefore stored at 1/1000th of its
-- correct cost-per-base-unit (e.g. a raw material priced "per kg" showing €0.0095/kg instead of
-- €9.50/kg). This corrects every already-stored row using the material's CURRENT base_unit_code
-- — the schema has never tracked a historical base unit per purchase, so that's the same basis
-- the rest of the app already uses to interpret cost_per_base_unit_micros.
UPDATE purchase_records
SET cost_per_base_unit_micros = CAST(ROUND(
    cost_per_base_unit_micros * (
        SELECT mu.to_base_factor
        FROM raw_materials rm
        JOIN measurement_units mu ON mu.code = rm.base_unit_code
        WHERE rm.id = purchase_records.raw_material_id
    )
) AS INTEGER)
WHERE raw_material_id IN (
    SELECT rm.id
    FROM raw_materials rm
    JOIN measurement_units mu ON mu.code = rm.base_unit_code
    WHERE mu.to_base_factor != 1.0
);
