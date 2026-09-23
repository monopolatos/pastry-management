use tauri::State;

use crate::auth::SessionState;
use crate::db::repositories::recipes::{
    self, CostSnapshotSummary, CostingRawMaterial, RecipeCostingGraph, RecipeDetail, RecipeInput,
    RecipeSummary,
};
use crate::error::{AppError, AppResult};
use crate::DbState;

fn current_user_id(session: &State<SessionState>) -> AppResult<Option<i64>> {
    Ok(session
        .0
        .lock()
        .map_err(|e| AppError::new(e.to_string()))?
        .as_ref()
        .map(|s| s.user.id))
}

#[tauri::command]
pub fn list_recipes(db: State<DbState>, include_archived: bool) -> AppResult<Vec<RecipeSummary>> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    recipes::list(&conn, include_archived)
}

#[tauri::command]
pub fn get_recipe(db: State<DbState>, id: i64) -> AppResult<RecipeDetail> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    recipes::get(&conn, id)
}

#[tauri::command]
pub fn create_recipe(
    db: State<DbState>,
    session: State<SessionState>,
    input: RecipeInput,
) -> AppResult<RecipeDetail> {
    let user_id = current_user_id(&session)?;
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    recipes::create(&conn, input, user_id)
}

#[tauri::command]
pub fn update_recipe(
    db: State<DbState>,
    session: State<SessionState>,
    id: i64,
    input: RecipeInput,
) -> AppResult<RecipeDetail> {
    let user_id = current_user_id(&session)?;
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    recipes::update(&conn, id, input, user_id)
}

#[tauri::command]
pub fn archive_recipe(db: State<DbState>, id: i64) -> AppResult<()> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    recipes::set_active(&conn, id, false)
}

#[tauri::command]
pub fn reactivate_recipe(db: State<DbState>, id: i64) -> AppResult<()> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    recipes::set_active(&conn, id, true)
}

#[tauri::command]
pub fn delete_recipe(db: State<DbState>, id: i64) -> AppResult<()> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    recipes::delete(&conn, id)
}

#[tauri::command]
pub fn duplicate_recipe(
    db: State<DbState>,
    id: i64,
    new_name: Option<String>,
) -> AppResult<RecipeDetail> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    recipes::duplicate(&conn, id, new_name)
}

#[tauri::command]
pub fn get_recipe_costing_graph(db: State<DbState>, id: i64) -> AppResult<RecipeCostingGraph> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    recipes::get_costing_graph(&conn, id)
}

#[tauri::command]
pub fn list_raw_material_costing(db: State<DbState>) -> AppResult<Vec<CostingRawMaterial>> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    recipes::get_all_raw_materials_costing(&conn)
}

#[tauri::command]
pub fn save_recipe_cost_snapshot(
    db: State<DbState>,
    recipe_id: i64,
    pricing_strategy_summary: String,
    total_cost_micros: i64,
    cost_per_yield_unit_micros: i64,
    breakdown_json: String,
) -> AppResult<i64> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    recipes::save_cost_snapshot(
        &conn,
        recipe_id,
        &pricing_strategy_summary,
        total_cost_micros,
        cost_per_yield_unit_micros,
        &breakdown_json,
    )
}

#[tauri::command]
pub fn list_recipe_cost_snapshots(
    db: State<DbState>,
    recipe_id: i64,
) -> AppResult<Vec<CostSnapshotSummary>> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    recipes::list_cost_snapshots(&conn, recipe_id)
}
