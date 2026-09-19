/**
 * Every Tauri command in this app can reject with this shape (see src-tauri/src/error.rs). When
 * `invoke()` rejects, the rejection value IS this object (Tauri serializes the Err payload
 * as-is), so `catch (err)` gives us `{ message, field? }` rather than a generic Error.
 */
export interface AppError {
  message: string;
  field?: string;
}

function looksLikeAppError(value: unknown): value is { message: unknown; field?: unknown } {
  return typeof value === "object" && value !== null && "message" in value;
}

/** Normalizes anything a `catch` block might see into an {@link AppError}. */
export function toAppError(err: unknown): AppError {
  if (looksLikeAppError(err) && typeof err.message === "string") {
    const field = typeof err.field === "string" ? err.field : undefined;
    return { message: err.message, field };
  }
  if (err instanceof Error) {
    return { message: err.message };
  }
  return { message: String(err) };
}
