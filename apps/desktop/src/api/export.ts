import { invoke } from "@tauri-apps/api/core";

/**
 * Typed wrappers around `commands::export` — the native "Save As" dialog plus the actual disk
 * write for content generated client-side (currently just the raw materials PDF). The webview has
 * no direct filesystem access, so this is the only way a generated file reaches disk.
 */

/** Opens a native save dialog filtered to `extension` (no leading dot), pre-filled with
 * `defaultName`. Resolves to `null` if the user cancels. */
export function chooseSavePath(defaultName: string, extension: string): Promise<string | null> {
  return invoke("choose_save_path", { defaultName, extension });
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Writes `data` to `path` (already chosen via `chooseSavePath`). */
export function writeBinaryFile(path: string, data: ArrayBuffer): Promise<void> {
  return invoke("write_binary_file", { path, dataBase64: arrayBufferToBase64(data) });
}
