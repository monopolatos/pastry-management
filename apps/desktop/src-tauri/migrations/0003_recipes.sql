-- Migration 0003: recipes, versioning, nested-recipe ingredients, and cost snapshots (Phase 4).
--
-- See docs/database-schema.md for the full rationale. Key points repeated here for anyone reading
-- just the SQL:
--   - Editing a recipe creates a NEW recipe_versions row rather than mutating the old one, so
--     historical cost snapshots always resolve against the exact ingredient list they were
--     calculated from.
--   - recipe_ingredients.sub_recipe_id lets a recipe be used as an ingredient in another recipe
--     (nested recipes). The Rust repository (not just this schema) enforces at write time that
--     adding such a link can never create a cycle — see db/repositories/recipes.rs.
--   - recipe_cost_snapshots is an audit trail only; the "current" cost is always recomputed by the
--     costing engine (packages/core), never trusted from a stored snapshot.

CREATE TABLE recipes (
    id                  INTEGER PRIMARY KEY,
    name                TEXT NOT NULL,
    description         TEXT,
    category            TEXT,
    instructions        TEXT,
    prep_time_minutes   INTEGER,
    cook_time_minutes   INTEGER,
    status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    -- Nullable and set only after the first recipe_versions row is inserted (SQLite resolves this
    -- forward reference lazily, at write time, so the create-recipe-then-create-version-then-
    -- backfill-this-column sequence works fine even though recipe_versions is defined below).
    current_version_id  INTEGER REFERENCES recipe_versions(id),
    notes               TEXT,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Versioned fields are exactly the ones that affect a cost calculation (yield + ingredients,
-- the latter in recipe_ingredients below). Free-text fields (name, description, instructions,
-- category, notes) live only on `recipes` and are edited in place without bumping a version —
-- versioning exists for cost-audit integrity, not prose history.
CREATE TABLE recipe_versions (
    id                  INTEGER PRIMARY KEY,
    recipe_id           INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    version_number      INTEGER NOT NULL,
    yield_quantity      REAL NOT NULL CHECK (yield_quantity > 0),
    yield_unit_code     TEXT NOT NULL REFERENCES measurement_units(code),
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    created_by_user_id  INTEGER REFERENCES users(id),
    UNIQUE (recipe_id, version_number)
);

CREATE TABLE recipe_ingredients (
    id                  INTEGER PRIMARY KEY,
    recipe_version_id   INTEGER NOT NULL REFERENCES recipe_versions(id) ON DELETE CASCADE,
    ingredient_type     TEXT NOT NULL CHECK (ingredient_type IN ('raw_material', 'recipe')),
    raw_material_id     INTEGER REFERENCES raw_materials(id) ON DELETE RESTRICT,
    -- Always resolved to the referenced recipe's CURRENT version at calculation time — a
    -- sub-recipe edit is automatically reflected in every parent recipe that uses it.
    sub_recipe_id       INTEGER REFERENCES recipes(id) ON DELETE RESTRICT,
    quantity            REAL NOT NULL CHECK (quantity > 0),
    unit_code           TEXT NOT NULL REFERENCES measurement_units(code),
    sort_order          INTEGER NOT NULL DEFAULT 0,
    CHECK (
        (ingredient_type = 'raw_material' AND raw_material_id IS NOT NULL AND sub_recipe_id IS NULL)
        OR
        (ingredient_type = 'recipe' AND sub_recipe_id IS NOT NULL AND raw_material_id IS NULL)
    )
);

CREATE INDEX idx_recipe_ingredients_version ON recipe_ingredients(recipe_version_id);
CREATE INDEX idx_recipe_ingredients_raw_material ON recipe_ingredients(raw_material_id);
CREATE INDEX idx_recipe_ingredients_sub_recipe ON recipe_ingredients(sub_recipe_id);

CREATE TABLE recipe_cost_snapshots (
    id                          INTEGER PRIMARY KEY,
    recipe_id                   INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    recipe_version_id           INTEGER NOT NULL REFERENCES recipe_versions(id) ON DELETE CASCADE,
    calculated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    pricing_strategy_summary    TEXT NOT NULL,
    total_cost_micros           INTEGER NOT NULL,
    cost_per_yield_unit_micros  INTEGER NOT NULL,
    breakdown_json              TEXT NOT NULL
);

CREATE INDEX idx_recipe_cost_snapshots_recipe ON recipe_cost_snapshots(recipe_id, calculated_at DESC);
