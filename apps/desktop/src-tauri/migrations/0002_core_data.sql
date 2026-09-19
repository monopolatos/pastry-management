-- Migration 0002: authentication and core business data (Phase 3).
--
-- Recipes and their supporting tables (recipe_versions, recipe_ingredients,
-- recipe_cost_snapshots) are intentionally deferred to a later migration (Phase 4) rather than
-- created empty here now — see docs/roadmap.md. The full target schema is documented up front in
-- docs/database-schema.md; migrations land it incrementally as each phase actually uses it.

CREATE TABLE users (
    id              INTEGER PRIMARY KEY,
    username        TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    role            TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'employee')),
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE suppliers (
    id              INTEGER PRIMARY KEY,
    name            TEXT NOT NULL,
    contact_person  TEXT,
    phone           TEXT,
    email           TEXT,
    address         TEXT,
    vat_number      TEXT,
    notes           TEXT,
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE raw_materials (
    id                      INTEGER PRIMARY KEY,
    name                    TEXT NOT NULL,
    description             TEXT,
    category                TEXT,
    base_unit_code          TEXT NOT NULL REFERENCES measurement_units(code),
    default_supplier_id     INTEGER REFERENCES suppliers(id),
    pricing_strategy        TEXT NOT NULL DEFAULT 'latest' CHECK (pricing_strategy IN ('latest', 'average_n', 'manual')),
    pricing_strategy_config TEXT,
    notes                   TEXT,
    is_active               INTEGER NOT NULL DEFAULT 1,
    created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_raw_materials_default_supplier ON raw_materials(default_supplier_id);

-- Append-only price history. No UPDATE/DELETE is exposed by the application on this table (see
-- docs/database-schema.md "Preserve historical purchase prices" / requirement §8) — a mistaken
-- entry is corrected by recording a new purchase, never by editing or removing history.
CREATE TABLE purchase_records (
    id                          INTEGER PRIMARY KEY,
    raw_material_id             INTEGER NOT NULL REFERENCES raw_materials(id) ON DELETE RESTRICT,
    -- Nullable: a purchase (e.g. a market/cash buy with no formal supplier account) may still need
    -- its price tracked without forcing a supplier record to exist.
    supplier_id                 INTEGER REFERENCES suppliers(id) ON DELETE RESTRICT,
    purchase_date               TEXT NOT NULL,
    quantity                    REAL NOT NULL CHECK (quantity > 0),
    purchase_unit_code          TEXT NOT NULL REFERENCES measurement_units(code),
    total_price_micros          INTEGER NOT NULL CHECK (total_price_micros >= 0),
    cost_per_base_unit_micros   INTEGER NOT NULL,
    expiration_date             TEXT,
    notes                       TEXT,
    created_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    created_by_user_id          INTEGER REFERENCES users(id)
);

CREATE INDEX idx_purchase_records_material_date ON purchase_records(raw_material_id, purchase_date DESC);
CREATE INDEX idx_purchase_records_material_supplier_date ON purchase_records(raw_material_id, supplier_id, purchase_date DESC);
