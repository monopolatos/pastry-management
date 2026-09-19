import { useCallback, useState } from "react";
import { toAppError } from "../api/errors";

/**
 * Consistent convention for showing backend errors on a form: a general, form-level banner for
 * errors that don't name a specific field (or name a field the form doesn't render), and
 * per-field messages for errors that do.
 *
 * Usage:
 *   const formError = useFormError();
 *   ...
 *   try {
 *     formError.clear();
 *     await createSupplier(input);
 *   } catch (err) {
 *     formError.handle(err, ["name", "email"]); // known field names this form renders
 *   }
 *   ...
 *   {formError.general && <p className="form-error">{formError.general}</p>}
 *   <input name="email" ... />
 *   {formError.fieldError("email") && <p className="field-error">{formError.fieldError("email")}</p>}
 */
export function useFormError() {
  const [general, setGeneral] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const clear = useCallback(() => {
    setGeneral(null);
    setFields({});
  }, []);

  const handle = useCallback((err: unknown, knownFields: readonly string[]) => {
    const appErr = toAppError(err);
    if (appErr.field && knownFields.includes(appErr.field)) {
      setGeneral(null);
      setFields({ [appErr.field]: appErr.message });
    } else {
      setGeneral(appErr.message);
      setFields({});
    }
  }, []);

  const fieldError = useCallback((name: string): string | undefined => fields[name], [fields]);

  return { general, fieldError, handle, clear };
}
