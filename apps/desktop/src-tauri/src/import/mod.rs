//! Excel import for categories and raw materials ("products"), from a two-sheet `.xlsx` workbook:
//! sheet index 0 = products (a header row, then Name / Category / Purchase price €/kg / ... /
//! Comments columns — only name, category, price, and comments are read; any other columns are
//! ignored), sheet index 1 = categories (no header, one category name per row).
//!
//! Parsing (this module) is kept separate from the database side effects (`commands::import`) so
//! the row-extraction logic can be unit-tested against an in-memory `Range` without needing a real
//! `.xlsx` file on disk — the same separation-of-concerns convention as the costing engine living
//! in `packages/core` independent of the database.

use calamine::{open_workbook, Data, DataType, Range, Reader, Xlsx};
use std::path::Path;

pub struct ParsedProductRow {
    pub name: String,
    pub category_name: Option<String>,
    pub price_per_kg: Option<f64>,
    pub notes: Option<String>,
}

fn cell_string(row: &[Data], index: usize) -> Option<String> {
    row.get(index)
        .and_then(|c| c.get_string())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
}

/// Sheet index 1: one category name per row, no header. Blank rows are skipped; duplicate names
/// (case-insensitive, matching the `categories.name COLLATE NOCASE UNIQUE` constraint) are
/// collapsed to their first occurrence.
pub fn parse_categories(range: &Range<Data>) -> Vec<String> {
    let mut seen_lowercase = std::collections::HashSet::new();
    let mut result = Vec::new();
    for row in range.rows() {
        let Some(name) = cell_string(row, 0) else {
            continue;
        };
        if seen_lowercase.insert(name.to_lowercase()) {
            result.push(name);
        }
    }
    result
}

/// Sheet index 0: row 0 is a header and is always skipped. Columns, by position: 0 = name
/// (required — rows with no name are skipped entirely), 1 = category name, 2 = purchase price in
/// €/kg, 4 = free-text comments (column 3, waste/shrinkage %, is intentionally not imported — see
/// docs/database-schema.md's raw materials section).
pub fn parse_products(range: &Range<Data>) -> Vec<ParsedProductRow> {
    let mut result = Vec::new();
    for row in range.rows().skip(1) {
        let Some(name) = cell_string(row, 0) else {
            continue;
        };
        let category_name = cell_string(row, 1);
        let price_per_kg = row.get(2).and_then(|c| c.as_f64());
        let notes = cell_string(row, 4);
        result.push(ParsedProductRow {
            name,
            category_name,
            price_per_kg,
            notes,
        });
    }
    result
}

/// Opens the workbook and reads both sheets by position (not by name — a user's workbook may not
/// name its sheets "Sheet1"/"Categories", but "products first, categories second" is the
/// documented, position-based contract for this importer).
pub fn read_workbook(path: &Path) -> Result<(Range<Data>, Range<Data>), String> {
    let mut workbook: Xlsx<_> =
        open_workbook(path).map_err(|e| format!("Could not open workbook: {e}"))?;

    let products = workbook
        .worksheet_range_at(0)
        .ok_or_else(|| "The workbook has no first sheet (expected products).".to_string())?
        .map_err(|e| format!("Could not read the products sheet: {e}"))?;

    let categories = workbook
        .worksheet_range_at(1)
        .ok_or_else(|| "The workbook has no second sheet (expected categories).".to_string())?
        .map_err(|e| format!("Could not read the categories sheet: {e}"))?;

    Ok((products, categories))
}

#[cfg(test)]
mod tests {
    use super::*;
    use calamine::Cell;

    fn range_from_rows(rows: &[&[Data]]) -> Range<Data> {
        let mut cells = Vec::new();
        for (r, row) in rows.iter().enumerate() {
            for (c, value) in row.iter().enumerate() {
                cells.push(Cell::new((r as u32, c as u32), value.clone()));
            }
        }
        Range::from_sparse(cells)
    }

    #[test]
    fn parse_categories_skips_blank_rows_and_trims() {
        let range = range_from_rows(&[
            &[Data::String("  Vegan  ".into())],
            &[Data::Empty],
            &[Data::String("Dairy".into())],
        ]);
        let result = parse_categories(&range);
        assert_eq!(result, vec!["Vegan".to_string(), "Dairy".to_string()]);
    }

    #[test]
    fn parse_categories_dedupes_case_insensitively_keeping_first_casing() {
        let range = range_from_rows(&[
            &[Data::String("Vegan".into())],
            &[Data::String("vegan".into())],
            &[Data::String("VEGAN".into())],
        ]);
        let result = parse_categories(&range);
        assert_eq!(result, vec!["Vegan".to_string()]);
    }

    #[test]
    fn parse_products_skips_header_row() {
        let range = range_from_rows(&[
            &[
                Data::String("Name".into()),
                Data::String("Category".into()),
                Data::String("Price".into()),
            ],
            &[
                Data::String("Flour".into()),
                Data::String("Dry Goods".into()),
                Data::Float(0.43),
            ],
        ]);
        let result = parse_products(&range);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name, "Flour");
    }

    #[test]
    fn parse_products_skips_rows_with_no_name() {
        let range = range_from_rows(&[
            &[Data::String("Name".into())],
            &[Data::Empty, Data::String("Dry Goods".into())],
            &[Data::String("Flour".into())],
        ]);
        let result = parse_products(&range);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name, "Flour");
    }

    #[test]
    fn parse_products_reads_name_category_price_and_comments() {
        let range = range_from_rows(&[
            &[Data::String("Name".into())],
            &[
                Data::String("Flour".into()),
                Data::String("Dry Goods".into()),
                Data::Float(0.43),
                Data::Float(0.0),
                Data::String("Base for pastries".into()),
            ],
        ]);
        let result = parse_products(&range);
        assert_eq!(result.len(), 1);
        let row = &result[0];
        assert_eq!(row.name, "Flour");
        assert_eq!(row.category_name.as_deref(), Some("Dry Goods"));
        assert_eq!(row.price_per_kg, Some(0.43));
        assert_eq!(row.notes.as_deref(), Some("Base for pastries"));
    }

    #[test]
    fn parse_products_handles_missing_category_price_and_comments() {
        let range = range_from_rows(&[
            &[Data::String("Name".into())],
            &[Data::String("Flour".into())],
        ]);
        let result = parse_products(&range);
        assert_eq!(result.len(), 1);
        let row = &result[0];
        assert_eq!(row.category_name, None);
        assert_eq!(row.price_per_kg, None);
        assert_eq!(row.notes, None);
    }

    #[test]
    fn parse_products_reads_integer_price_as_float() {
        let range = range_from_rows(&[
            &[Data::String("Name".into())],
            &[
                Data::String("Eggs".into()),
                Data::String("Dairy".into()),
                Data::Int(4),
            ],
        ]);
        let result = parse_products(&range);
        assert_eq!(result[0].price_per_kg, Some(4.0));
    }
}
