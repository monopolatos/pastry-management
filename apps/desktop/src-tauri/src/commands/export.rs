//! Generic "save generated file to disk" support for client-side exports (currently just the raw
//! materials PDF — see `RawMaterialsScreen`'s "Export PDF" button). The PDF itself is built
//! entirely in the frontend (content and layout are presentation concerns, same division of labor
//! as the rest of the app's client-side business logic); this module only owns the native save
//! dialog and the actual disk write, since the webview has no direct filesystem access.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use tauri_plugin_dialog::DialogExt;

use crate::error::AppError;
use crate::error::AppResult;

#[tauri::command]
pub async fn choose_save_path(
    app: tauri::AppHandle,
    default_name: String,
    extension: String,
) -> AppResult<Option<String>> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .add_filter(extension.to_uppercase(), &[extension.as_str()])
        .set_file_name(&default_name)
        .save_file(move |file| {
            let _ = tx.send(file);
        });
    let picked = rx
        .recv()
        .map_err(|e| AppError::new(format!("Save dialog did not respond: {e}")))?;
    Ok(picked.map(|p| p.to_string()))
}

/// Writes base64-encoded bytes (e.g. a PDF built in the frontend via jsPDF) to a path already
/// chosen through `choose_save_path`.
#[tauri::command]
pub fn write_binary_file(path: String, data_base64: String) -> AppResult<()> {
    let bytes = BASE64
        .decode(data_base64)
        .map_err(|e| AppError::new(format!("Could not decode file data: {e}")))?;
    std::fs::write(&path, bytes).map_err(|e| AppError::new(format!("Could not write file: {e}")))
}
