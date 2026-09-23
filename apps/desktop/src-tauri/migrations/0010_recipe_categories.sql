-- Migration 0010: recipe categories become a managed entity, not free text — same rationale and
-- pattern as migration 0007 did for raw_materials.category, now applied to recipes.category. Kept
-- as its own table (not merged into `categories`) since the two are conceptually distinct groupings
-- (ingredient groupings vs. recipe groupings) with independent name spaces.

CREATE TABLE recipe_categories (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL COLLATE NOCASE UNIQUE,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Backfill: every distinct category string already in use by an existing recipe becomes a real
-- category row, so no existing data is lost when the column below is replaced by a FK.
INSERT INTO recipe_categories (name)
SELECT DISTINCT TRIM(category) FROM recipes
WHERE category IS NOT NULL AND TRIM(category) != '';

ALTER TABLE recipes ADD COLUMN category_id INTEGER REFERENCES recipe_categories(id);

UPDATE recipes
SET category_id = (SELECT id FROM recipe_categories WHERE recipe_categories.name = TRIM(recipes.category))
WHERE category IS NOT NULL AND TRIM(category) != '';

ALTER TABLE recipes DROP COLUMN category;

CREATE INDEX idx_recipes_category ON recipes(category_id);
