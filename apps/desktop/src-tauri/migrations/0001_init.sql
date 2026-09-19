-- Migration 0001: schema bookkeeping + measurement units.
--
-- Every migration file in this directory is applied at most once, in filename order, inside a
-- single transaction (see src/db/mod.rs). schema_migrations records which have run so the app can
-- detect and refuse to start against an unknown/ahead-of-code schema version rather than silently
-- corrupting data (see docs/database-schema.md).

CREATE TABLE schema_migrations (
    version     INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    applied_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Weight, volume, and count are distinct measurement kinds and are never auto-converted into one
-- another without an explicit, user-configured density (see docs/database-schema.md and
-- docs/costing-engine.md). to_base_factor converts a quantity of this unit into its base unit.
CREATE TABLE measurement_units (
    code            TEXT PRIMARY KEY,
    kind            TEXT NOT NULL CHECK (kind IN ('weight', 'volume', 'count')),
    base_unit_code  TEXT NOT NULL,
    to_base_factor  REAL NOT NULL CHECK (to_base_factor > 0)
);

INSERT INTO measurement_units (code, kind, base_unit_code, to_base_factor) VALUES
    ('g',     'weight', 'g',     1.0),
    ('kg',    'weight', 'g',     1000.0),
    ('ml',    'volume', 'ml',    1.0),
    ('l',     'volume', 'ml',    1000.0),
    ('piece', 'count',  'piece', 1.0);
