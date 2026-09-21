import { useState } from "react";
import type { FormEvent } from "react";
import * as categoriesApi from "../../api/categories";
import { toAppError } from "../../api/errors";
import type { Category } from "../../api/types";
import { useFormError } from "../../hooks/useFormError";
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
      setRowError(toAppError(err).message);
    }
  }

  async function handleDelete(id: number) {
    setRowError(null);
    try {
      await categoriesApi.deleteCategory(id);
      onChanged();
    } catch (err) {
      setRowError(toAppError(err).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Manage categories</DialogTitle>
          <DialogDescription>
            Categories used by raw materials. Archive one instead of deleting it if any raw material
            still uses it.
          </DialogDescription>
        </DialogHeader>

        <form className="flex items-end gap-2" onSubmit={handleCreate}>
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="new-category-name">New category</Label>
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
            {submitting ? "Adding…" : "Add"}
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
            Show archived
          </Label>
        </div>

        <div className="max-h-72 overflow-y-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-sm text-muted-foreground">
                    No categories yet.
                  </TableCell>
                </TableRow>
              ) : (
                visible.map((category) => (
                  <TableRow key={category.id}>
                    <TableCell>{category.name}</TableCell>
                    <TableCell>
                      <Badge variant={category.is_active ? "default" : "secondary"}>
                        {category.is_active ? "Active" : "Archived"}
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
                          {category.is_active ? "Archive" : "Reactivate"}
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button type="button" variant="destructive" size="sm">
                              Delete
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete "{category.name}"?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This permanently deletes the category. This cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                variant="destructive"
                                onClick={() => handleDelete(category.id)}
                              >
                                Delete
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
