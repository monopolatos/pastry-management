//! Read-only access to the seeded `measurement_units` table (see migration 0001). There is no
//! create/update/delete here — the set of units is fixed at the schema level for now (see
//! docs/database-schema.md: weight, volume, and count are never auto-converted into each other).

use rusqlite::Connection;
use serde::Serialize;

use crate::error::AppResult;

#[derive(Debug, Clone, Serialize)]
pub struct MeasurementUnit {
    pub code: String,
    pub kind: String,
    pub base_unit_code: String,
    pub to_base_factor: f64,
}

pub fn list(conn: &Connection) -> AppResult<Vec<MeasurementUnit>> {
    let mut stmt =
        conn.prepare("SELECT code, kind, base_unit_code, to_base_factor FROM measurement_units")?;
    let rows = stmt.query_map([], |r| {
        Ok(MeasurementUnit {
            code: r.get(0)?,
            kind: r.get(1)?,
            base_unit_code: r.get(2)?,
            to_base_factor: r.get(3)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_the_five_seeded_units() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("../../../migrations/0001_init.sql"))
            .unwrap();
        let units = list(&conn).unwrap();
        assert_eq!(units.len(), 5);
    }
}
