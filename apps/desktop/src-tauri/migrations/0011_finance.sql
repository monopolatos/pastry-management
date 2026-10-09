-- Migration 0011: expense/income tracking — a new, independent module from the costing side of
-- the app (raw materials/recipes/purchase_records), which only ever tracked ingredient cost, never
-- actual shop revenue or non-ingredient spending (rent, wages, utilities, ...).
--
-- Two managed category tables, same archive-over-delete pattern as migrations 0007/0010 (and for
-- the same reason: independent name spaces — "Rent" as an expense category and "Catering" as an
-- income category have nothing to do with each other). Entries themselves (expenses/income) are
-- plain ledger rows, not append-only like purchase_records: a mistyped amount or wrong date on a
-- manually-logged expense is a data-entry slip to fix in place, not a historical fact to preserve.

CREATE TABLE expense_categories (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL COLLATE NOCASE UNIQUE,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE income_categories (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL COLLATE NOCASE UNIQUE,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE expenses (
    id                  INTEGER PRIMARY KEY,
    expense_date        TEXT NOT NULL,
    category_id         INTEGER REFERENCES expense_categories(id) ON DELETE RESTRICT,
    amount_micros       INTEGER NOT NULL,
    description         TEXT,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    created_by_user_id  INTEGER REFERENCES users(id)
);

CREATE INDEX idx_expenses_date ON expenses(expense_date);
CREATE INDEX idx_expenses_category ON expenses(category_id);

CREATE TABLE income_entries (
    id                  INTEGER PRIMARY KEY,
    income_date         TEXT NOT NULL,
    category_id         INTEGER REFERENCES income_categories(id) ON DELETE RESTRICT,
    amount_micros       INTEGER NOT NULL,
    description         TEXT,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    created_by_user_id  INTEGER REFERENCES users(id)
);

CREATE INDEX idx_income_entries_date ON income_entries(income_date);
CREATE INDEX idx_income_entries_category ON income_entries(category_id);
