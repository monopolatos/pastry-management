import { useState } from "react";
import { Upload } from "lucide-react";
import * as importApi from "../../api/import";
import { toAppError } from "../../api/errors";
import type { ImportSummary } from "../../api/types";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

interface ImportDialogProps {
  /** Called once after a run that created or skipped at least one row, so the raw materials and
   * categories lists refresh. Not called if the user just cancelled the file picker. */
  onImported: () => void;
}

type State =
  | { stage: "idle" }
  | { stage: "importing" }
  | { stage: "done"; summary: ImportSummary }
  | { stage: "error"; message: string };

function SummaryList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm font-medium">
        {title} ({items.length})
      </p>
      <ul className="max-h-32 list-disc overflow-y-auto pl-5 text-sm text-muted-foreground">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * "Import from Excel" — picks a `.xlsx` file (products on the first sheet, categories on the
 * second, see src-tauri/src/import/mod.rs) and shows a summary report of what was created vs.
 * skipped. Re-running on the same file is safe: existing categories/raw materials are left alone.
 */
export function ImportDialog({ onImported }: ImportDialogProps) {
  const [state, setState] = useState<State>({ stage: "idle" });
  const [reportOpen, setReportOpen] = useState(false);

  async function handleClick() {
    let path: string | null;
    try {
      path = await importApi.chooseExcelFile();
    } catch (err) {
      setState({ stage: "error", message: toAppError(err).message });
      setReportOpen(true);
      return;
    }
    if (path === null) return;

    setState({ stage: "importing" });
    setReportOpen(true);
    try {
      const summary = await importApi.importFromExcel(path);
      setState({ stage: "done", summary });
      onImported();
    } catch (err) {
      setState({ stage: "error", message: toAppError(err).message });
    }
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={handleClick}>
        <Upload className="size-4" />
        Import from Excel
      </Button>

      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Import from Excel</DialogTitle>
            <DialogDescription>
              First sheet: products (name, category, price €/kg, comments). Second sheet:
              categories.
            </DialogDescription>
          </DialogHeader>

          {state.stage === "importing" && (
            <p className="text-sm text-muted-foreground">Importing…</p>
          )}

          {state.stage === "error" && (
            <p className="text-sm font-medium text-destructive">{state.message}</p>
          )}

          {state.stage === "done" && (
            <div className="flex flex-col gap-4">
              <SummaryList title="Categories added" items={state.summary.categories_created} />
              <SummaryList
                title="Categories already existed"
                items={state.summary.categories_already_existed}
              />
              <SummaryList title="Raw materials added" items={state.summary.products_created} />
              <SummaryList
                title="Skipped — already exist"
                items={state.summary.products_skipped_existing}
              />
              <SummaryList
                title="Skipped — could not be imported"
                items={state.summary.products_skipped_invalid}
              />
              {state.summary.categories_created.length === 0 &&
                state.summary.categories_already_existed.length === 0 &&
                state.summary.products_created.length === 0 &&
                state.summary.products_skipped_existing.length === 0 &&
                state.summary.products_skipped_invalid.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Nothing found to import in this file.
                  </p>
                )}
            </div>
          )}

          <DialogFooter>
            <Button type="button" onClick={() => setReportOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
