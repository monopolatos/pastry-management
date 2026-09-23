-- Migration 0008: optional grams-per-portion on recipe_versions (Phase 11 recipe-editor redesign).
--
-- Versioned alongside yield_quantity/yield_unit_code since it's part of the same "how much does
-- this recipe make" question — lets the UI derive a portion count and cost/portion for weight-
-- yield recipes without inventing a separate, unversioned table for a single nullable number.
ALTER TABLE recipe_versions ADD COLUMN grams_per_portion REAL CHECK (grams_per_portion IS NULL OR grams_per_portion > 0);
