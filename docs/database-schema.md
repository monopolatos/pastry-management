# Database Schema (Phase 1 Proposal)

Engine: SQLite, accessed only from the Rust core (`rusqlite`), with versioned migrations in `src-tauri/migrations/NNNN_description.sql`. Every migration is forward-only and wrapped in a transaction; a `schema_migrations` table tracks applied versions so failed migrations can be detected and the app refuses to run against an unknown/ahead-of-code schema version rather than silently corrupting data.

Monetary and per-base-unit cost values are stored as **INTEGER micros** (value × 1,000,000) to avoid float error while keeping enough precision for fractional-cent per-gram costs (e.g. €0.0025/g = `2500` micros). All arithmetic on these values happens in `packages/core` using `decimal.js`; SQLite only stores and sums integers.

```
users
  id INTEGER PK
  username TEXT UNIQUE NOT NULL
  password_hash TEXT NOT NULL        -- Argon2id
  role TEXT NOT NULL CHECK (role IN ('owner','admin','employee'))
  is_active INTEGER NOT NULL DEFAULT 1
  created_at, updated_at TEXT (ISO8601)

measurement_units
  code TEXT PK                       -- 'g','kg','ml','l','piece'
  kind TEXT NOT NULL CHECK (kind IN ('weight','volume','count'))
  base_unit_code TEXT NOT NULL       -- 'g' for weight, 'ml' for volume, 'piece' for count
  to_base_factor REAL NOT NULL       -- e.g. kg -> g = 1000
  -- Weight and volume are never auto-converted into each other (no implied density).

suppliers
  id INTEGER PK
  name TEXT NOT NULL
  contact_person, phone, email, address TEXT
  vat_number TEXT
  notes TEXT
  is_active INTEGER NOT NULL DEFAULT 1
  created_at, updated_at TEXT

raw_materials
  id INTEGER PK
  name TEXT NOT NULL
  description TEXT
  category TEXT
  base_unit_code TEXT NOT NULL REFERENCES measurement_units(code)
  default_supplier_id INTEGER REFERENCES suppliers(id)
  pricing_strategy TEXT NOT NULL DEFAULT 'latest'   -- 'latest' | 'average_n' | 'manual'
  pricing_strategy_config TEXT                       -- JSON, e.g. {"n":5} or {"manual_price_micros":...}
  expiration_tracking INTEGER NOT NULL DEFAULT 0
  notes TEXT
  is_active INTEGER NOT NULL DEFAULT 1
  created_at, updated_at TEXT

purchase_records                     -- append-only price history, never overwritten
  id INTEGER PK
  raw_material_id INTEGER NOT NULL REFERENCES raw_materials(id)
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id)
  purchase_date TEXT NOT NULL
  quantity REAL NOT NULL CHECK (quantity > 0)
  purchase_unit_code TEXT NOT NULL REFERENCES measurement_units(code)
  total_price_micros INTEGER NOT NULL CHECK (total_price_micros >= 0)
  cost_per_base_unit_micros INTEGER NOT NULL   -- derived & stored at insert time for fast lookups
  expiration_date TEXT
  notes TEXT
  created_at TEXT
  created_by_user_id INTEGER REFERENCES users(id)
  INDEX (raw_material_id, purchase_date DESC)
  INDEX (raw_material_id, supplier_id, purchase_date DESC)

recipes
  id INTEGER PK
  name TEXT NOT NULL
  description TEXT
  category TEXT
  instructions TEXT
  prep_time_minutes INTEGER
  cook_time_minutes INTEGER
  yield_quantity REAL NOT NULL CHECK (yield_quantity > 0)
  yield_unit_code TEXT NOT NULL REFERENCES measurement_units(code)
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived'))
  current_version_id INTEGER            -- FK to recipe_versions, set after first version created
  notes TEXT
  created_at, updated_at TEXT

recipe_versions                        -- edits create a new version; nothing is destructively overwritten
  id INTEGER PK
  recipe_id INTEGER NOT NULL REFERENCES recipes(id)
  version_number INTEGER NOT NULL
  yield_quantity REAL NOT NULL
  yield_unit_code TEXT NOT NULL REFERENCES measurement_units(code)
  instructions TEXT
  created_at TEXT
  created_by_user_id INTEGER REFERENCES users(id)
  UNIQUE (recipe_id, version_number)

recipe_ingredients
  id INTEGER PK
  recipe_version_id INTEGER NOT NULL REFERENCES recipe_versions(id)
  ingredient_type TEXT NOT NULL CHECK (ingredient_type IN ('raw_material','recipe'))
  raw_material_id INTEGER REFERENCES raw_materials(id)
  sub_recipe_id INTEGER REFERENCES recipes(id)     -- references the recipe, always resolved to
                                                     -- its CURRENT active version at calc time
  quantity REAL NOT NULL CHECK (quantity > 0)
  unit_code TEXT NOT NULL REFERENCES measurement_units(code)
  sort_order INTEGER NOT NULL DEFAULT 0
  CHECK ( (ingredient_type='raw_material' AND raw_material_id IS NOT NULL AND sub_recipe_id IS NULL)
       OR (ingredient_type='recipe' AND sub_recipe_id IS NOT NULL AND raw_material_id IS NULL) )

recipe_cost_snapshots                  -- historical record only, NEVER the source of truth for "current cost"
  id INTEGER PK
  recipe_id INTEGER NOT NULL REFERENCES recipes(id)
  recipe_version_id INTEGER NOT NULL REFERENCES recipe_versions(id)
  calculated_at TEXT NOT NULL
  pricing_strategy_summary TEXT NOT NULL   -- JSON describing which strategy/prices were used
  total_cost_micros INTEGER NOT NULL
  cost_per_yield_unit_micros INTEGER NOT NULL
  breakdown_json TEXT NOT NULL             -- full per-ingredient breakdown, for audit/history display

backup_configs
  id INTEGER PK
  destination_type TEXT NOT NULL CHECK (destination_type IN ('local','dropbox','google_drive'))
  local_path TEXT
  cloud_account_label TEXT             -- display name only; actual tokens live in OS keyring, never here
  auto_backup_enabled INTEGER NOT NULL DEFAULT 0
  auto_backup_frequency TEXT           -- 'daily' | 'weekly'
  retention_count INTEGER DEFAULT 10
  created_at, updated_at TEXT

app_settings
  key TEXT PK
  value TEXT NOT NULL                  -- JSON; covers locale, currency, update prefs, etc.
  updated_at TEXT
```

**Nested recipes:** `recipe_ingredients.ingredient_type='recipe'` is how sub-recipes are modeled — a recipe ingredient row points at another recipe rather than a raw material. The costing engine resolves this recursively (see `costing-engine.md`) and the DB layer enforces acyclicity at write time (see below), not just at read time.

**Cycle prevention at the schema/service boundary:** before inserting/updating a `recipe_ingredients` row with `ingredient_type='recipe'`, the repository runs a DFS from the _target_ sub-recipe to check whether the _owning_ recipe appears anywhere in its (existing) ingredient graph; if so the write is rejected with a descriptive error naming the cycle path. This is enforced in the Rust command handler, not just the UI, so it can't be bypassed.

**Deletion policy:** raw materials, suppliers, and recipes are never hard-deleted while referenced by purchase history or recipe versions — `is_active=0` / `status='archived'` is used instead. Hard delete is only permitted for records with zero references (enforced by FK `ON DELETE RESTRICT`).
