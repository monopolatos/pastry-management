-- Migration 0007: raw material categories become a managed entity, not free text.
--
-- Previously `raw_materials.category` was a plain nullable TEXT column, offered back to the user
-- as a picker built from whatever category strings already happened to exist on other materials
-- (see src/components/rawMaterials/RawMaterialForm.tsx before this migration). That has no
-- preselected starting list and no way to rename/archive a category independently of the
-- materials using it. `categories` is now a first-class table, following the same archive-over-
-- delete pattern as suppliers (see docs/database-schema.md's deletion policy).
--
-- COLLATE NOCASE on `name` avoids near-duplicate categories ("Vegan" vs "vegan") both at the
-- UNIQUE-constraint level and for ORDER BY, without requiring the application layer to normalize
-- case itself.

CREATE TABLE categories (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL COLLATE NOCASE UNIQUE,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Backfill: every distinct category string already in use by an existing raw material becomes a
-- real category row, so no existing data is lost when the column below is replaced by a FK.
INSERT INTO categories (name)
SELECT DISTINCT TRIM(category) FROM raw_materials
WHERE category IS NOT NULL AND TRIM(category) != '';

ALTER TABLE raw_materials ADD COLUMN category_id INTEGER REFERENCES categories(id);

UPDATE raw_materials
SET category_id = (SELECT id FROM categories WHERE categories.name = TRIM(raw_materials.category))
WHERE category IS NOT NULL AND TRIM(category) != '';

ALTER TABLE raw_materials DROP COLUMN category;

CREATE INDEX idx_raw_materials_category ON raw_materials(category_id);
