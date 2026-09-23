use tauri::State;

use crate::db::repositories::recipe_categories::{self, RecipeCategory, RecipeCategoryInput};
use crate::error::{AppError, AppResult};
use crate::DbState;

#[tauri::command]
pub fn list_recipe_categories(
    db: State<DbState>,
    include_inactive: bool,
) -> AppResult<Vec<RecipeCategory>> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    recipe_categories::list(&conn, include_inactive)
}

#[tauri::command]
pub fn create_recipe_category(
    db: State<DbState>,
    input: RecipeCategoryInput,
) -> AppResult<RecipeCategory> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    recipe_categories::create(&conn, input)
}

#[tauri::command]
pub fn update_recipe_category(
    db: State<DbState>,
    id: i64,
    input: RecipeCategoryInput,
) -> AppResult<RecipeCategory> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    recipe_categories::update(&conn, id, input)
}

#[tauri::command]
pub fn archive_recipe_category(db: State<DbState>, id: i64) -> AppResult<()> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    recipe_categories::set_active(&conn, id, false)
}

#[tauri::command]
pub fn reactivate_recipe_category(db: State<DbState>, id: i64) -> AppResult<()> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    recipe_categories::set_active(&conn, id, true)
}

#[tauri::command]
pub fn delete_recipe_category(db: State<DbState>, id: i64) -> AppResult<()> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    recipe_categories::delete(&conn, id)
}
