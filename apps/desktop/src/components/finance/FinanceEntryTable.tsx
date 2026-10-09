import { Pencil, Trash2 } from "lucide-react";
import { useI18n } from "../../lib/i18n";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

export interface FinanceEntryRow {
  id: number;
  date: string;
  categoryName: string | null;
  amountMicros: number;
  description: string | null;
}

interface FinanceEntryTableProps {
  rows: FinanceEntryRow[];
  emptyMessage: string;
  /** "+" for income (shown in a success color), "-" for expenses (destructive color). */
  sign: "+" | "-";
  onEdit: (id: number) => void;
  onDelete: (id: number) => Promise<void>;
}

function formatMoney(micros: number): string {
  return (micros / 1_000_000).toFixed(2);
}

/** Shared table for both the Expenses and Income lists on the Finance screen — same shape
 * (date, category, description, amount, edit/delete), differing only in which sign/color the
 * amount gets. The caller owns search/filter/sort state and just hands this the already-filtered,
 * already-sorted rows to render. */
export function FinanceEntryTable({
  rows,
  emptyMessage,
  sign,
  onEdit,
  onDelete,
}: FinanceEntryTableProps) {
  const { t } = useI18n();

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("common.date")}</TableHead>
            <TableHead>{t("common.category")}</TableHead>
            <TableHead>{t("common.description")}</TableHead>
            <TableHead>{t("finance.amount")}</TableHead>
            <TableHead>{t("common.actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>{row.date}</TableCell>
              <TableCell>{row.categoryName ?? "—"}</TableCell>
              <TableCell className="max-w-xs truncate">{row.description ?? "—"}</TableCell>
              <TableCell
                className={
                  sign === "+"
                    ? "font-medium text-green-700 dark:text-green-400"
                    : "font-medium text-destructive"
                }
              >
                {sign}€{formatMoney(row.amountMicros)}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    title={t("common.edit")}
                    onClick={() => onEdit(row.id)}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 text-destructive hover:text-destructive"
                        title={t("common.delete")}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t("finance.deleteEntryConfirmTitle")}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {t("common.deleteCannotBeUndone")}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                        <AlertDialogAction variant="destructive" onClick={() => onDelete(row.id)}>
                          {t("common.delete")}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
