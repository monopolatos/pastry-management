import { useState } from "react";
import type { FormEvent } from "react";
import * as categoriesApi from "../../api/categories";
import type { Category } from "../../api/types";
import { useFormError } from "../../hooks/useFormError";
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
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

interface CategoriesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: Category[];
  /** Called after any create/archive/reactivate/delete, so the caller's category list refreshes. */
  onChanged: () => void;
}

const KNOWN_FIELDS = ["name"] as const;

/**
 * "Manage categories" — a plain CRUD list, opened from the Raw Materials screen. Categories are a
 * managed entity (see migration 0007) so they can be preselected from the start (e.g. via Excel
 * import) and still let the user add their own, per the original request.
 */
export function CategoriesDialog({
  open,
  onOpenChange,
  categories,
  onChanged,
}: CategoriesDialogProps) {
  const { t, te } = useI18n();
  const [includeInactive, setIncludeInactive] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const formError = useFormError();

  const visible = includeInactive ? categories : categories.filter((c) => c.is_active);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    formError.clear();
    if (name.trim() === "") {
      formError.handle({ message: "Category name is required.", field: "name" }, ["name"]);
      return;
    }
    setSubmitting(true);
    try {
      await categoriesApi.createCategory({ name: name.trim() });
      setName("");
      onChanged();
    } catch (err) {
      formError.handle(err, KNOWN_FIELDS);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleArchiveToggle(category: Category) {
    setRowError(null);
    try {
      if (category.is_active) {
        await categoriesApi.archiveCategory(category.id);
      } else {
        await categoriesApi.reactivateCategory(category.id);
      }
      onChanged();
    } catch (err) {
      setRowError(te(err));
    }
  }

  async function handleDelete(id: number) {
    setRowError(null);
    try {
      await categoriesApi.deleteCategory(id);
      onChanged();
    } catch (err) {
      setRowError(te(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("rawMaterials.manageCategories")}</DialogTitle>
          <DialogDescription>{t("categories.dialogDescription")}</DialogDescription>
        </DialogHeader>

        <form className="flex items-end gap-2" onSubmit={handleCreate}>
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="new-category-name">{t("categories.newCategory")}</Label>
            <Input
              id="new-category-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {formError.fieldError("name") && (
              <p className="text-sm text-destructive">{formError.fieldError("name")}</p>
            )}
          </div>
          <Button type="submit" disabled={submitting}>
            {submitting ? t("common.adding") : t("common.add")}
          </Button>
        </form>
        {formError.general && (
          <p className="text-sm font-medium text-destructive">{formError.general}</p>
        )}
        {rowError && <p className="text-sm font-medium text-destructive">{rowError}</p>}

        <div className="flex items-center gap-2">
          <Label className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
            />
            {t("common.showArchived")}
          </Label>
        </div>

        <div className="max-h-72 overflow-y-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.name")}</TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead>{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-sm text-muted-foreground">
                    {t("categories.empty")}
                  </TableCell>
                </TableRow>
              ) : (
                visible.map((category) => (
                  <TableRow key={category.id}>
                    <TableCell>{category.name}</TableCell>
                    <TableCell>
                      <Badge variant={category.is_active ? "default" : "secondary"}>
                        {category.is_active ? t("common.active") : t("common.archived")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleArchiveToggle(category)}
                        >
                          {category.is_active ? t("common.archive") : t("common.reactivate")}
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button type="button" variant="destructive" size="sm">
                              {t("common.delete")}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                {t("common.deleteConfirmTitle").replace("{name}", category.name)}
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                {t("categories.deleteConfirmBody")}{" "}
                                {t("common.deleteCannotBeUndone")}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                              <AlertDialogAction
                                variant="destructive"
                                onClick={() => handleDelete(category.id)}
                              >
                                {t("common.delete")}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
