//! Recipe repository: CRUD with versioning, nested-recipe (sub-recipe) ingredients, write-time
//! cycle/archived-reference prevention, and the "costing graph" query that bundles everything the
//! pure-TypeScript costing engine (`packages/core`) needs to compute a cost breakdown.
//!
//! This module deliberately does NOT compute costs itself — it only stores/retrieves data and
//! guards data integrity (cycles, archived references). Resolving purchase prices and walking the
//! ingredient graph to a total cost is `packages/core`'s job (see docs/costing-engine.md), kept
//! independent of both the database and the UI so it can be unit-tested in isolation.

use std::collections::HashSet;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
pub struct RecipeSummary {
    pub id: i64,
    pub name: String,
    pub category: Option<String>,
    pub status: String,
    pub version_number: i64,
    pub yield_quantity: f64,
    pub yield_unit_code: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RecipeIngredient {
    pub id: i64,
    pub ingredient_type: String,
    pub raw_material_id: Option<i64>,
    pub sub_recipe_id: Option<i64>,
    /// Denormalized for display convenience — the raw material's or sub-recipe's current name.
    pub ingredient_name: String,
    pub quantity: f64,
    pub unit_code: String,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct RecipeDetail {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub instructions: Option<String>,
    pub prep_time_minutes: Option<i64>,
    pub cook_time_minutes: Option<i64>,
    pub status: String,
    pub notes: Option<String>,
    pub version_number: i64,
    pub yield_quantity: f64,
    pub yield_unit_code: String,
    /// Optional — lets the UI derive a portion count / cost-per-portion for weight-yield recipes.
    pub grams_per_portion: Option<f64>,
    pub ingredients: Vec<RecipeIngredient>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct RecipeIngredientInput {
    pub ingredient_type: String,
    pub raw_material_id: Option<i64>,
    pub sub_recipe_id: Option<i64>,
    pub quantity: f64,
    pub unit_code: String,
}

#[derive(Debug, Deserialize)]
pub struct RecipeInput {
    pub name: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub instructions: Option<String>,
    pub prep_time_minutes: Option<i64>,
    pub cook_time_minutes: Option<i64>,
    pub notes: Option<String>,
    pub yield_quantity: f64,
    pub yield_unit_code: String,
    pub grams_per_portion: Option<f64>,
    pub ingredients: Vec<RecipeIngredientInput>,
}

// --- Costing graph DTOs — consumed by packages/core's calculateRecipeCost, not by this module ---

#[derive(Debug, Clone, Serialize)]
pub struct CostingIngredient {
    pub ingredient_type: String,
    pub raw_material_id: Option<i64>,
    pub sub_recipe_id: Option<i64>,
    pub quantity: f64,
    pub unit_code: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CostingRecipeNode {
    pub id: i64,
    pub name: String,
    pub status: String,
    pub yield_quantity: f64,
    pub yield_unit_code: String,
    pub ingredients: Vec<CostingIngredient>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CostingPurchaseRecord {
    pub purchase_date: String,
    pub cost_per_base_unit_micros: i64,
    /// Null when the purchase had no recorded supplier (see purchase_records repository).
    pub supplier_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CostingRawMaterial {
    pub id: i64,
    pub name: String,
    pub base_unit_code: String,
    pub pricing_strategy: String,
    pub pricing_strategy_config: Option<String>,
    pub purchase_history: Vec<CostingPurchaseRecord>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CostingUnit {
    pub code: String,
    pub kind: String,
    pub to_base_factor: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct RecipeCostingGraph {
    pub target_recipe_id: i64,
    pub recipes: Vec<CostingRecipeNode>,
    pub raw_materials: Vec<CostingRawMaterial>,
    pub units: Vec<CostingUnit>,
}

fn validate_ingredient(
    conn: &Connection,
    owning_recipe_id: Option<i64>,
    ing: &RecipeIngredientInput,
) -> AppResult<()> {
    if ing.quantity <= 0.0 {
        return Err(AppError::field(
            "ingredients",
            "Ingredient quantity must be greater than zero.",
        ));
    }
    let unit_exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM measurement_units WHERE code = ?1",
            [&ing.unit_code],
            |r| r.get::<_, i64>(0),
        )
        .map(|c| c > 0)?;
    if !unit_exists {
        return Err(AppError::field(
            "ingredients",
            format!("'{}' is not a known measurement unit.", ing.unit_code),
        ));
    }

    match ing.ingredient_type.as_str() {
        "raw_material" => {
            let id = ing.raw_material_id.ok_or_else(|| {
                AppError::field(
                    "ingredients",
                    "Raw material ingredient is missing a material.",
                )
            })?;
            let exists: bool = conn
                .query_row(
                    "SELECT COUNT(*) FROM raw_materials WHERE id = ?1",
                    [id],
                    |r| r.get::<_, i64>(0),
                )
                .map(|c| c > 0)?;
            if !exists {
                return Err(AppError::field(
                    "ingredients",
                    "Selected raw material does not exist.",
                ));
            }
        }
        "recipe" => {
            let sub_id = ing.sub_recipe_id.ok_or_else(|| {
                AppError::field("ingredients", "Recipe ingredient is missing a sub-recipe.")
            })?;

            if let Some(owning_id) = owning_recipe_id {
                if sub_id == owning_id {
                    return Err(AppError::field(
                        "ingredients",
                        "A recipe cannot use itself as an ingredient.",
                    ));
                }
            }

            let sub_status: Option<String> = conn
                .query_row("SELECT status FROM recipes WHERE id = ?1", [sub_id], |r| {
                    r.get(0)
                })
                .optional()?;
            match sub_status.as_deref() {
                None => return Err(AppError::field("ingredients", "Selected sub-recipe does not exist.")),
                Some("archived") => {
                    return Err(AppError::field(
                        "ingredients",
                        "That recipe is archived and can't be used as an ingredient in a new or edited recipe.",
                    ))
                }
                _ => {}
            }

            if let Some(owning_id) = owning_recipe_id {
                assert_no_cycle(conn, owning_id, sub_id)?;
            }
        }
        other => {
            return Err(AppError::field(
                "ingredients",
                format!("Unknown ingredient type '{other}'."),
            ))
        }
    }

    Ok(())
}

/// DFS from `candidate_sub_recipe_id` through its current version's recipe-type ingredients; if
/// `owning_recipe_id` is ever reached, adding this link would create a cycle.
fn assert_no_cycle(
    conn: &Connection,
    owning_recipe_id: i64,
    candidate_sub_recipe_id: i64,
) -> AppResult<()> {
    let mut visited = HashSet::new();
    let mut path = vec![candidate_sub_recipe_id];
    let mut stack = vec![candidate_sub_recipe_id];

    while let Some(current) = stack.pop() {
        if current == owning_recipe_id {
            let names: Vec<String> = {
                let mut stmt = conn.prepare("SELECT name FROM recipes WHERE id = ?1")?;
                let mut names = Vec::new();
                for id in path.iter().chain(std::iter::once(&owning_recipe_id)) {
                    names.push(
                        stmt.query_row([id], |r| r.get::<_, String>(0))
                            .unwrap_or_else(|_| format!("#{id}")),
                    );
                }
                names
            };
            return Err(AppError::new(format!(
                "Adding this ingredient would create a circular reference: {}.",
                names.join(" → ")
            )));
        }
        if !visited.insert(current) {
            continue;
        }

        let Some(version_id) = current_version_id(conn, current)? else {
            continue;
        };
        let mut stmt = conn.prepare(
            "SELECT sub_recipe_id FROM recipe_ingredients
             WHERE recipe_version_id = ?1 AND ingredient_type = 'recipe'",
        )?;
        let children: Vec<i64> = stmt
            .query_map([version_id], |r| r.get(0))?
            .collect::<Result<Vec<_>, _>>()?;
        for child in children {
            path.push(child);
            stack.push(child);
        }
    }

    Ok(())
}

fn current_version_id(conn: &Connection, recipe_id: i64) -> AppResult<Option<i64>> {
    Ok(conn
        .query_row(
            "SELECT current_version_id FROM recipes WHERE id = ?1",
            [recipe_id],
            |r| r.get(0),
        )
        .optional()?
        .flatten())
}

fn insert_version_with_ingredients(
    conn: &Connection,
    recipe_id: i64,
    input: &RecipeInput,
    created_by_user_id: Option<i64>,
) -> AppResult<i64> {
    let next_version: i64 = conn.query_row(
        "SELECT COALESCE(MAX(version_number), 0) + 1 FROM recipe_versions WHERE recipe_id = ?1",
        [recipe_id],
        |r| r.get(0),
    )?;

    conn.execute(
        "INSERT INTO recipe_versions (recipe_id, version_number, yield_quantity, yield_unit_code, grams_per_portion, created_by_user_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            recipe_id,
            next_version,
            input.yield_quantity,
            input.yield_unit_code,
            input.grams_per_portion,
            created_by_user_id
        ],
    )?;
    let version_id = conn.last_insert_rowid();

    for (idx, ing) in input.ingredients.iter().enumerate() {
        conn.execute(
            "INSERT INTO recipe_ingredients
                (recipe_version_id, ingredient_type, raw_material_id, sub_recipe_id, quantity, unit_code, sort_order)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                version_id,
                ing.ingredient_type,
                ing.raw_material_id,
                ing.sub_recipe_id,
                ing.quantity,
                ing.unit_code,
                idx as i64,
            ],
        )?;
    }

    conn.execute(
        "UPDATE recipes SET current_version_id = ?1 WHERE id = ?2",
        params![version_id, recipe_id],
    )?;

    Ok(version_id)
}

fn validate_recipe_fields(input: &RecipeInput) -> AppResult<()> {
    if input.name.trim().is_empty() {
        return Err(AppError::field("name", "Recipe name is required."));
    }
    if input.yield_quantity <= 0.0 {
        return Err(AppError::field(
            "yield_quantity",
            "Yield must be greater than zero.",
        ));
    }
    if input.ingredients.is_empty() {
        return Err(AppError::field(
            "ingredients",
            "A recipe needs at least one ingredient.",
        ));
    }
    if let Some(grams_per_portion) = input.grams_per_portion {
        if grams_per_portion <= 0.0 {
            return Err(AppError::field(
                "grams_per_portion",
                "Grams per portion must be greater than zero.",
            ));
        }
    }
    Ok(())
}

pub fn create(
    conn: &Connection,
    input: RecipeInput,
    created_by_user_id: Option<i64>,
) -> AppResult<RecipeDetail> {
    validate_recipe_fields(&input)?;
    let yield_unit_exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM measurement_units WHERE code = ?1",
            [&input.yield_unit_code],
            |r| r.get::<_, i64>(0),
        )
        .map(|c| c > 0)?;
    if !yield_unit_exists {
        return Err(AppError::field(
            "yield_unit_code",
            format!(
                "'{}' is not a known measurement unit.",
                input.yield_unit_code
            ),
        ));
    }
    for ing in &input.ingredients {
        validate_ingredient(conn, None, ing)?;
    }

    conn.execute(
        "INSERT INTO recipes (name, description, category, instructions, prep_time_minutes, cook_time_minutes, notes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            input.name.trim(),
            input.description,
            input.category,
            input.instructions,
            input.prep_time_minutes,
            input.cook_time_minutes,
            input.notes,
        ],
    )?;
    let recipe_id = conn.last_insert_rowid();
    insert_version_with_ingredients(conn, recipe_id, &input, created_by_user_id)?;

    get(conn, recipe_id)
}

pub fn update(
    conn: &Connection,
    id: i64,
    input: RecipeInput,
    created_by_user_id: Option<i64>,
) -> AppResult<RecipeDetail> {
    validate_recipe_fields(&input)?;
    let exists: bool = conn
        .query_row("SELECT COUNT(*) FROM recipes WHERE id = ?1", [id], |r| {
            r.get::<_, i64>(0)
        })
        .map(|c| c > 0)?;
    if !exists {
        return Err(AppError::new(format!("Recipe {id} was not found.")));
    }
    for ing in &input.ingredients {
        validate_ingredient(conn, Some(id), ing)?;
    }

    conn.execute(
        "UPDATE recipes
         SET name = ?1, description = ?2, category = ?3, instructions = ?4, prep_time_minutes = ?5,
             cook_time_minutes = ?6, notes = ?7, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?8",
        params![
            input.name.trim(),
            input.description,
            input.category,
            input.instructions,
            input.prep_time_minutes,
            input.cook_time_minutes,
            input.notes,
            id,
        ],
    )?;
    insert_version_with_ingredients(conn, id, &input, created_by_user_id)?;

    get(conn, id)
}

struct RecipeHeaderRow {
    id: i64,
    name: String,
    description: Option<String>,
    category: Option<String>,
    instructions: Option<String>,
    prep_time_minutes: Option<i64>,
    cook_time_minutes: Option<i64>,
    status: String,
    notes: Option<String>,
    created_at: String,
    updated_at: String,
    version_id: i64,
    version_number: i64,
    yield_quantity: f64,
    yield_unit_code: String,
    grams_per_portion: Option<f64>,
}

pub fn get(conn: &Connection, id: i64) -> AppResult<RecipeDetail> {
    let header = conn
        .query_row(
            "SELECT r.id, r.name, r.description, r.category, r.instructions, r.prep_time_minutes,
                    r.cook_time_minutes, r.status, r.notes, r.created_at, r.updated_at,
                    v.id, v.version_number, v.yield_quantity, v.yield_unit_code, v.grams_per_portion
             FROM recipes r
             JOIN recipe_versions v ON v.id = r.current_version_id
             WHERE r.id = ?1",
            [id],
            |row| {
                Ok(RecipeHeaderRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    category: row.get(3)?,
                    instructions: row.get(4)?,
                    prep_time_minutes: row.get(5)?,
                    cook_time_minutes: row.get(6)?,
                    status: row.get(7)?,
                    notes: row.get(8)?,
                    created_at: row.get(9)?,
                    updated_at: row.get(10)?,
                    version_id: row.get(11)?,
                    version_number: row.get(12)?,
                    yield_quantity: row.get(13)?,
                    yield_unit_code: row.get(14)?,
                    grams_per_portion: row.get(15)?,
                })
            },
        )
        .optional()?
        .ok_or_else(|| AppError::new(format!("Recipe {id} was not found.")))?;

    let RecipeHeaderRow {
        id,
        name,
        description,
        category,
        instructions,
        prep_time_minutes,
        cook_time_minutes,
        status,
        notes,
        created_at,
        updated_at,
        version_id,
        version_number,
        yield_quantity,
        yield_unit_code,
        grams_per_portion,
    } = header;

    struct IngredientRow {
        id: i64,
        ingredient_type: String,
        raw_material_id: Option<i64>,
        sub_recipe_id: Option<i64>,
        quantity: f64,
        unit_code: String,
        sort_order: i64,
    }

    let mut stmt = conn.prepare(
        "SELECT id, ingredient_type, raw_material_id, sub_recipe_id, quantity, unit_code, sort_order
         FROM recipe_ingredients WHERE recipe_version_id = ?1 ORDER BY sort_order",
    )?;
    let ingredient_rows: Vec<IngredientRow> = stmt
        .query_map([version_id], |r| {
            Ok(IngredientRow {
                id: r.get(0)?,
                ingredient_type: r.get(1)?,
                raw_material_id: r.get(2)?,
                sub_recipe_id: r.get(3)?,
                quantity: r.get(4)?,
                unit_code: r.get(5)?,
                sort_order: r.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut ingredients = Vec::with_capacity(ingredient_rows.len());
    for row in ingredient_rows {
        let IngredientRow {
            id: ing_id,
            ingredient_type,
            raw_material_id,
            sub_recipe_id,
            quantity,
            unit_code,
            sort_order,
        } = row;
        let name = if ingredient_type == "raw_material" {
            conn.query_row(
                "SELECT name FROM raw_materials WHERE id = ?1",
                [raw_material_id.unwrap_or_default()],
                |r| r.get(0),
            )?
        } else {
            conn.query_row(
                "SELECT name FROM recipes WHERE id = ?1",
                [sub_recipe_id.unwrap_or_default()],
                |r| r.get(0),
            )?
        };
        ingredients.push(RecipeIngredient {
            id: ing_id,
            ingredient_type,
            raw_material_id,
            sub_recipe_id,
            ingredient_name: name,
            quantity,
            unit_code,
            sort_order,
        });
    }

    Ok(RecipeDetail {
        id,
        name,
        description,
        category,
        instructions,
        prep_time_minutes,
        cook_time_minutes,
        status,
        notes,
        version_number,
        yield_quantity,
        yield_unit_code,
        grams_per_portion,
        ingredients,
        created_at,
        updated_at,
    })
}

pub fn list(conn: &Connection, include_archived: bool) -> AppResult<Vec<RecipeSummary>> {
    let sql = format!(
        "SELECT r.id, r.name, r.category, r.status, v.version_number, v.yield_quantity, v.yield_unit_code, r.updated_at
         FROM recipes r
         JOIN recipe_versions v ON v.id = r.current_version_id
         {}
         ORDER BY r.name",
        if include_archived { "" } else { "WHERE r.status = 'active'" }
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], |r| {
        Ok(RecipeSummary {
            id: r.get(0)?,
            name: r.get(1)?,
            category: r.get(2)?,
            status: r.get(3)?,
            version_number: r.get(4)?,
            yield_quantity: r.get(5)?,
            yield_unit_code: r.get(6)?,
            updated_at: r.get(7)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn set_active(conn: &Connection, id: i64, active: bool) -> AppResult<()> {
    let status = if active { "active" } else { "archived" };
    let affected = conn.execute(
        "UPDATE recipes SET status = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?2",
        params![status, id],
    )?;
    if affected == 0 {
        return Err(AppError::new(format!("Recipe {id} was not found.")));
    }
    Ok(())
}

/// Hard delete — only permitted when this recipe is not used as an ingredient anywhere else and
/// has no cost snapshots. Prefer `set_active(id, false)` (archiving) otherwise.
pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    let referenced: i64 = conn.query_row(
        "SELECT
            (SELECT COUNT(*) FROM recipe_ingredients WHERE sub_recipe_id = ?1) +
            (SELECT COUNT(*) FROM recipe_cost_snapshots WHERE recipe_id = ?1)",
        [id],
        |r| r.get(0),
    )?;
    if referenced > 0 {
        return Err(AppError::new(
            "This recipe is used as an ingredient elsewhere or has cost history and cannot be deleted. Archive it instead.",
        ));
    }
    let affected = conn.execute("DELETE FROM recipes WHERE id = ?1", [id])?;
    if affected == 0 {
        return Err(AppError::new(format!("Recipe {id} was not found.")));
    }
    Ok(())
}

pub fn duplicate(conn: &Connection, id: i64, new_name: Option<String>) -> AppResult<RecipeDetail> {
    let original = get(conn, id)?;
    let name = new_name.unwrap_or_else(|| format!("{} (Copy)", original.name));

    let input = RecipeInput {
        name,
        description: original.description,
        category: original.category,
        instructions: original.instructions,
        prep_time_minutes: original.prep_time_minutes,
        cook_time_minutes: original.cook_time_minutes,
        notes: original.notes,
        yield_quantity: original.yield_quantity,
        yield_unit_code: original.yield_unit_code,
        grams_per_portion: original.grams_per_portion,
        ingredients: original
            .ingredients
            .iter()
            .map(|i| RecipeIngredientInput {
                ingredient_type: i.ingredient_type.clone(),
                raw_material_id: i.raw_material_id,
                sub_recipe_id: i.sub_recipe_id,
                quantity: i.quantity,
                unit_code: i.unit_code.clone(),
            })
            .collect(),
    };

    create(conn, input, None)
}

pub fn get_costing_graph(
    conn: &Connection,
    target_recipe_id: i64,
) -> AppResult<RecipeCostingGraph> {
    let mut visited = HashSet::new();
    let mut stack = vec![target_recipe_id];
    let mut recipe_nodes = Vec::new();
    let mut raw_material_ids: HashSet<i64> = HashSet::new();

    while let Some(rid) = stack.pop() {
        if !visited.insert(rid) {
            continue;
        }

        let (name, status, version_id, yield_quantity, yield_unit_code): (
            String,
            String,
            i64,
            f64,
            String,
        ) = conn
            .query_row(
                "SELECT r.name, r.status, v.id, v.yield_quantity, v.yield_unit_code
                 FROM recipes r JOIN recipe_versions v ON v.id = r.current_version_id
                 WHERE r.id = ?1",
                [rid],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .optional()?
            .ok_or_else(|| {
                AppError::new(format!(
                    "Recipe {rid} referenced in this recipe's graph no longer exists."
                ))
            })?;

        let mut stmt = conn.prepare(
            "SELECT ingredient_type, raw_material_id, sub_recipe_id, quantity, unit_code
             FROM recipe_ingredients WHERE recipe_version_id = ?1 ORDER BY sort_order",
        )?;
        let ingredients: Vec<CostingIngredient> = stmt
            .query_map([version_id], |r| {
                Ok(CostingIngredient {
                    ingredient_type: r.get(0)?,
                    raw_material_id: r.get(1)?,
                    sub_recipe_id: r.get(2)?,
                    quantity: r.get(3)?,
                    unit_code: r.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        for ing in &ingredients {
            match ing.ingredient_type.as_str() {
                "raw_material" => {
                    if let Some(rm_id) = ing.raw_material_id {
                        raw_material_ids.insert(rm_id);
                    }
                }
                "recipe" => {
                    if let Some(sub_id) = ing.sub_recipe_id {
                        stack.push(sub_id);
                    }
                }
                _ => {}
            }
        }

        recipe_nodes.push(CostingRecipeNode {
            id: rid,
            name,
            status,
            yield_quantity,
            yield_unit_code,
            ingredients,
        });
    }

    let mut raw_materials = Vec::with_capacity(raw_material_ids.len());
    for rm_id in raw_material_ids {
        let (name, base_unit_code, pricing_strategy, pricing_strategy_config): (String, String, String, Option<String>) =
            conn.query_row(
                "SELECT name, base_unit_code, pricing_strategy, pricing_strategy_config FROM raw_materials WHERE id = ?1",
                [rm_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )?;

        let mut stmt = conn.prepare(
            "SELECT p.purchase_date, p.cost_per_base_unit_micros, s.name
             FROM purchase_records p
             LEFT JOIN suppliers s ON s.id = p.supplier_id
             WHERE p.raw_material_id = ?1 ORDER BY p.purchase_date DESC, p.id DESC",
        )?;
        let purchase_history: Vec<CostingPurchaseRecord> = stmt
            .query_map([rm_id], |r| {
                Ok(CostingPurchaseRecord {
                    purchase_date: r.get(0)?,
                    cost_per_base_unit_micros: r.get(1)?,
                    supplier_name: r.get(2)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        raw_materials.push(CostingRawMaterial {
            id: rm_id,
            name,
            base_unit_code,
            pricing_strategy,
            pricing_strategy_config,
            purchase_history,
        });
    }

    let mut stmt = conn.prepare("SELECT code, kind, to_base_factor FROM measurement_units")?;
    let units: Vec<CostingUnit> = stmt
        .query_map([], |r| {
            Ok(CostingUnit {
                code: r.get(0)?,
                kind: r.get(1)?,
                to_base_factor: r.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(RecipeCostingGraph {
        target_recipe_id,
        recipes: recipe_nodes,
        raw_materials,
        units,
    })
}

/// Costing data (purchase history + pricing strategy) for every ACTIVE raw material, regardless
/// of whether any recipe currently references it. Unlike `get_costing_graph` (which only walks
/// the ingredients an already-saved recipe has), this powers the recipe editor's live, client-side
/// cost preview while the user is still picking ingredients for a recipe that may not be saved yet.
pub fn get_all_raw_materials_costing(conn: &Connection) -> AppResult<Vec<CostingRawMaterial>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, base_unit_code, pricing_strategy, pricing_strategy_config
         FROM raw_materials WHERE is_active = 1",
    )?;
    struct MaterialRow {
        id: i64,
        name: String,
        base_unit_code: String,
        pricing_strategy: String,
        pricing_strategy_config: Option<String>,
    }
    let materials: Vec<MaterialRow> = stmt
        .query_map([], |r| {
            Ok(MaterialRow {
                id: r.get(0)?,
                name: r.get(1)?,
                base_unit_code: r.get(2)?,
                pricing_strategy: r.get(3)?,
                pricing_strategy_config: r.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut result = Vec::with_capacity(materials.len());
    for m in materials {
        let mut stmt = conn.prepare(
            "SELECT p.purchase_date, p.cost_per_base_unit_micros, s.name
             FROM purchase_records p
             LEFT JOIN suppliers s ON s.id = p.supplier_id
             WHERE p.raw_material_id = ?1 ORDER BY p.purchase_date DESC, p.id DESC",
        )?;
        let purchase_history: Vec<CostingPurchaseRecord> = stmt
            .query_map([m.id], |r| {
                Ok(CostingPurchaseRecord {
                    purchase_date: r.get(0)?,
                    cost_per_base_unit_micros: r.get(1)?,
                    supplier_name: r.get(2)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        result.push(CostingRawMaterial {
            id: m.id,
            name: m.name,
            base_unit_code: m.base_unit_code,
            pricing_strategy: m.pricing_strategy,
            pricing_strategy_config: m.pricing_strategy_config,
            purchase_history,
        });
    }

    Ok(result)
}

pub fn save_cost_snapshot(
    conn: &Connection,
    recipe_id: i64,
    pricing_strategy_summary: &str,
    total_cost_micros: i64,
    cost_per_yield_unit_micros: i64,
    breakdown_json: &str,
) -> AppResult<i64> {
    let version_id: i64 = conn
        .query_row(
            "SELECT current_version_id FROM recipes WHERE id = ?1",
            [recipe_id],
            |r| r.get::<_, Option<i64>>(0),
        )?
        .ok_or_else(|| AppError::new(format!("Recipe {recipe_id} was not found.")))?;

    conn.execute(
        "INSERT INTO recipe_cost_snapshots
            (recipe_id, recipe_version_id, pricing_strategy_summary, total_cost_micros, cost_per_yield_unit_micros, breakdown_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![recipe_id, version_id, pricing_strategy_summary, total_cost_micros, cost_per_yield_unit_micros, breakdown_json],
    )?;
    Ok(conn.last_insert_rowid())
}

#[derive(Debug, Clone, Serialize)]
pub struct CostSnapshotSummary {
    pub id: i64,
    pub calculated_at: String,
    pub total_cost_micros: i64,
    pub cost_per_yield_unit_micros: i64,
}

pub fn list_cost_snapshots(
    conn: &Connection,
    recipe_id: i64,
) -> AppResult<Vec<CostSnapshotSummary>> {
    let mut stmt = conn.prepare(
        "SELECT id, calculated_at, total_cost_micros, cost_per_yield_unit_micros
         FROM recipe_cost_snapshots WHERE recipe_id = ?1 ORDER BY calculated_at DESC",
    )?;
    let rows = stmt.query_map([recipe_id], |r| {
        Ok(CostSnapshotSummary {
            id: r.get(0)?,
            calculated_at: r.get(1)?,
            total_cost_micros: r.get(2)?,
            cost_per_yield_unit_micros: r.get(3)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repositories::raw_materials;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("../../../migrations/0001_init.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../../../migrations/0002_core_data.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../../../migrations/0003_recipes.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../../../migrations/0007_categories.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../../../migrations/0008_recipe_portions.sql"))
            .unwrap();
        conn
    }

    fn seed_flour(conn: &Connection) -> i64 {
        raw_materials::create(
            conn,
            raw_materials::RawMaterialInput {
                name: "Flour".into(),
                description: None,
                category_id: None,
                base_unit_code: "g".into(),
                default_supplier_id: None,
                pricing_strategy: "latest".into(),
                pricing_strategy_config: None,
                notes: None,
            },
        )
        .unwrap()
        .id
    }

    fn simple_recipe_input(name: &str, material_id: i64) -> RecipeInput {
        RecipeInput {
            name: name.into(),
            description: None,
            category: None,
            instructions: None,
            prep_time_minutes: None,
            cook_time_minutes: None,
            notes: None,
            yield_quantity: 800.0,
            yield_unit_code: "g".into(),
            grams_per_portion: None,
            ingredients: vec![RecipeIngredientInput {
                ingredient_type: "raw_material".into(),
                raw_material_id: Some(material_id),
                sub_recipe_id: None,
                quantity: 500.0,
                unit_code: "g".into(),
            }],
        }
    }

    #[test]
    fn create_and_get_round_trip() {
        let conn = test_conn();
        let material_id = seed_flour(&conn);
        let created = create(&conn, simple_recipe_input("Ganache", material_id), None).unwrap();

        assert_eq!(created.version_number, 1);
        assert_eq!(created.ingredients.len(), 1);
        assert_eq!(created.ingredients[0].ingredient_name, "Flour");

        let fetched = get(&conn, created.id).unwrap();
        assert_eq!(fetched.id, created.id);
    }

    #[test]
    fn create_rejects_empty_ingredient_list() {
        let conn = test_conn();
        let mut input = simple_recipe_input("Empty", seed_flour(&conn));
        input.ingredients.clear();
        let err = create(&conn, input, None).unwrap_err();
        assert_eq!(err.field.as_deref(), Some("ingredients"));
    }

    #[test]
    fn create_rejects_zero_yield() {
        let conn = test_conn();
        let mut input = simple_recipe_input("Bad yield", seed_flour(&conn));
        input.yield_quantity = 0.0;
        let err = create(&conn, input, None).unwrap_err();
        assert_eq!(err.field.as_deref(), Some("yield_quantity"));
    }

    #[test]
    fn update_creates_a_new_version_without_losing_the_old_one() {
        let conn = test_conn();
        let material_id = seed_flour(&conn);
        let created = create(&conn, simple_recipe_input("Ganache", material_id), None).unwrap();

        let mut updated_input = simple_recipe_input("Ganache", material_id);
        updated_input.yield_quantity = 900.0;
        let updated = update(&conn, created.id, updated_input, None).unwrap();

        assert_eq!(updated.version_number, 2);
        assert_eq!(updated.yield_quantity, 900.0);

        let version_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM recipe_versions WHERE recipe_id = ?1",
                [created.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            version_count, 2,
            "the original version 1 row must still exist"
        );
    }

    #[test]
    fn nested_recipe_ingredient_is_accepted_and_resolves_its_name() {
        let conn = test_conn();
        let material_id = seed_flour(&conn);
        let ganache = create(&conn, simple_recipe_input("Ganache", material_id), None).unwrap();

        let cake_input = RecipeInput {
            name: "Chocolate Cake".into(),
            description: None,
            category: None,
            instructions: None,
            prep_time_minutes: None,
            cook_time_minutes: None,
            notes: None,
            yield_quantity: 10.0,
            yield_unit_code: "piece".into(),
            grams_per_portion: None,
            ingredients: vec![RecipeIngredientInput {
                ingredient_type: "recipe".into(),
                raw_material_id: None,
                sub_recipe_id: Some(ganache.id),
                quantity: 200.0,
                unit_code: "g".into(),
            }],
        };
        let cake = create(&conn, cake_input, None).unwrap();
        assert_eq!(cake.ingredients[0].ingredient_name, "Ganache");
    }

    #[test]
    fn direct_cycle_is_rejected() {
        let conn = test_conn();
        let material_id = seed_flour(&conn);
        let a = create(&conn, simple_recipe_input("A", material_id), None).unwrap();
        let b_input = RecipeInput {
            name: "B".into(),
            description: None,
            category: None,
            instructions: None,
            prep_time_minutes: None,
            cook_time_minutes: None,
            notes: None,
            yield_quantity: 1.0,
            yield_unit_code: "piece".into(),
            grams_per_portion: None,
            ingredients: vec![RecipeIngredientInput {
                ingredient_type: "recipe".into(),
                raw_material_id: None,
                sub_recipe_id: Some(a.id),
                quantity: 1.0,
                unit_code: "piece".into(),
            }],
        };
        let b = create(&conn, b_input, None).unwrap();

        // Now try to make A use B as an ingredient too: A -> B -> A, a direct cycle.
        let mut a_update = simple_recipe_input("A", material_id);
        a_update.ingredients.push(RecipeIngredientInput {
            ingredient_type: "recipe".into(),
            raw_material_id: None,
            sub_recipe_id: Some(b.id),
            quantity: 1.0,
            unit_code: "piece".into(),
        });

        let err = update(&conn, a.id, a_update, None).unwrap_err();
        assert!(
            err.message.contains("circular"),
            "unexpected message: {}",
            err.message
        );
    }

    #[test]
    fn self_reference_is_rejected() {
        let conn = test_conn();
        let material_id = seed_flour(&conn);
        let a = create(&conn, simple_recipe_input("A", material_id), None).unwrap();

        let mut self_referencing = simple_recipe_input("A", material_id);
        self_referencing.ingredients.push(RecipeIngredientInput {
            ingredient_type: "recipe".into(),
            raw_material_id: None,
            sub_recipe_id: Some(a.id),
            quantity: 1.0,
            unit_code: "piece".into(),
        });

        let err = update(&conn, a.id, self_referencing, None).unwrap_err();
        assert_eq!(err.field.as_deref(), Some("ingredients"));
    }

    #[test]
    fn archived_recipe_cannot_be_used_as_a_new_ingredient() {
        let conn = test_conn();
        let material_id = seed_flour(&conn);
        let a = create(&conn, simple_recipe_input("A", material_id), None).unwrap();
        set_active(&conn, a.id, false).unwrap();

        let b_input = RecipeInput {
            name: "B".into(),
            description: None,
            category: None,
            instructions: None,
            prep_time_minutes: None,
            cook_time_minutes: None,
            notes: None,
            yield_quantity: 1.0,
            yield_unit_code: "piece".into(),
            grams_per_portion: None,
            ingredients: vec![RecipeIngredientInput {
                ingredient_type: "recipe".into(),
                raw_material_id: None,
                sub_recipe_id: Some(a.id),
                quantity: 1.0,
                unit_code: "piece".into(),
            }],
        };
        let err = create(&conn, b_input, None).unwrap_err();
        assert!(err.message.contains("archived"));
    }

    #[test]
    fn delete_rejected_when_used_as_a_sub_recipe() {
        let conn = test_conn();
        let material_id = seed_flour(&conn);
        let ganache = create(&conn, simple_recipe_input("Ganache", material_id), None).unwrap();
        let cake_input = RecipeInput {
            name: "Cake".into(),
            description: None,
            category: None,
            instructions: None,
            prep_time_minutes: None,
            cook_time_minutes: None,
            notes: None,
            yield_quantity: 1.0,
            yield_unit_code: "piece".into(),
            grams_per_portion: None,
            ingredients: vec![RecipeIngredientInput {
                ingredient_type: "recipe".into(),
                raw_material_id: None,
                sub_recipe_id: Some(ganache.id),
                quantity: 1.0,
                unit_code: "piece".into(),
            }],
        };
        create(&conn, cake_input, None).unwrap();

        let err = delete(&conn, ganache.id).unwrap_err();
        assert!(err.message.contains("cannot be deleted"));
    }

    #[test]
    fn duplicate_creates_an_independent_copy() {
        let conn = test_conn();
        let material_id = seed_flour(&conn);
        let original = create(&conn, simple_recipe_input("Ganache", material_id), None).unwrap();

        let copy = duplicate(&conn, original.id, None).unwrap();
        assert_ne!(copy.id, original.id);
        assert_eq!(copy.name, "Ganache (Copy)");
        assert_eq!(copy.ingredients.len(), original.ingredients.len());
    }

    #[test]
    fn costing_graph_includes_nested_recipe_and_its_raw_materials() {
        let conn = test_conn();
        let material_id = seed_flour(&conn);
        let ganache = create(&conn, simple_recipe_input("Ganache", material_id), None).unwrap();
        let cake_input = RecipeInput {
            name: "Cake".into(),
            description: None,
            category: None,
            instructions: None,
            prep_time_minutes: None,
            cook_time_minutes: None,
            notes: None,
            yield_quantity: 10.0,
            yield_unit_code: "piece".into(),
            grams_per_portion: None,
            ingredients: vec![RecipeIngredientInput {
                ingredient_type: "recipe".into(),
                raw_material_id: None,
                sub_recipe_id: Some(ganache.id),
                quantity: 200.0,
                unit_code: "g".into(),
            }],
        };
        let cake = create(&conn, cake_input, None).unwrap();

        let graph = get_costing_graph(&conn, cake.id).unwrap();
        assert_eq!(
            graph.recipes.len(),
            2,
            "should include both the cake and the nested ganache"
        );
        assert_eq!(graph.raw_materials.len(), 1);
        assert_eq!(graph.raw_materials[0].id, material_id);
        assert!(!graph.units.is_empty());
    }
}
