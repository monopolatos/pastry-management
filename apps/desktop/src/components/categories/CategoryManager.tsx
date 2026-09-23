import { useState } from "react";
import type { ComponentType, FormEvent } from "react";
import { Archive, ArchiveRestore, Pencil, Plus, Trash2 } from "lucide-react";
import type { Category, CategoryInput } from "../../api/types";
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
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";

interface CategoryManagerApi {
  create: (input: CategoryInput) => Promise<Category>;
  update: (id: number, input: CategoryInput) => Promise<Category>;
  archive: (id: number) => Promise<void>;
  reactivate: (id: number) => Promise<void>;
  delete: (id: number) => Promise<void>;
}

interface CategoryManagerProps {
  title: string;
  icon: ComponentType<{ className?: string }>;
  categories: Category[];
  deleteConfirmBody: string;
  onChanged: () => void;
  api: CategoryManagerApi;
}

const KNOWN_FIELDS = ["name"] as const;

/**
 * Plain CRUD list for a "categories" table — create, rename, archive/reactivate, delete — shared
 * by both raw material and recipe categories (see the Categories screen, which renders this twice
 * with different backing data). Not a Dialog: this is embedded directly in a page section, so both
 * category types are visible and manageable side by side from their own dedicated nav entry rather
 * than buried behind a button on another screen.
 */
export function CategoryManager({
  title,
  icon: Icon,
  categories,
  deleteConfirmBody,
  onChanged,
  api,
}: CategoryManagerProps) {
  const { t, te } = useI18n();
  const [includeInactive, setIncludeInactive] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const formError = useFormError();

  const visible = includeInactive ? categories : categories.filter((c) => c.is_active);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    formError.clear();
    if (name.trim() === "") {
      formError.handle({ message: t("categories.nameRequired"), field: "name" }, ["name"]);
      return;
    }
    setSubmitting(true);
    try {
      await api.create({ name: name.trim() });
      setName("");
      setAdding(false);
      onChanged();
    } catch (err) {
      formError.handle(err, KNOWN_FIELDS);
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(category: Category) {
    setRowError(null);
    setEditingId(category.id);
    setEditName(category.name);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName("");
  }

  async function handleSaveEdit(id: number) {
    if (editName.trim() === "") {
      setRowError(t("categories.nameRequired"));
      return;
    }
    setRowError(null);
    setSavingEdit(true);
    try {
      await api.update(id, { name: editName.trim() });
      setEditingId(null);
      setEditName("");
      onChanged();
    } catch (err) {
      setRowError(te(err));
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleArchiveToggle(category: Category) {
    setRowError(null);
    try {
      if (category.is_active) {
        await api.archive(category.id);
      } else {
        await api.reactivate(category.id);
      }
      onChanged();
    } catch (err) {
      setRowError(te(err));
    }
  }

  async function handleDelete(id: number) {
    setRowError(null);
    try {
      await api.delete(id);
      onChanged();
    } catch (err) {
      setRowError(te(err));
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <Icon className="size-4 text-primary" />
            {title}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="gap-1.5"
              onClick={() => setAdding((v) => !v)}
            >
              <Plus className="size-4" />
              {t("common.add")}
            </Button>
            <label className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
              <input
                type="checkbox"
                checked={includeInactive}
                onChange={(e) => setIncludeInactive(e.target.checked)}
              />
              {t("common.showArchived")}
            </label>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {adding && (
          <form className="flex items-end gap-2" onSubmit={handleCreate}>
            <Input
              autoFocus
              type="text"
              placeholder={t("categories.newCategory")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-8"
            />
            <Button type="submit" size="sm" disabled={submitting}>
              {submitting ? t("common.adding") : t("common.add")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setAdding(false);
                setName("");
                formError.clear();
              }}
            >
              {t("common.cancel")}
            </Button>
          </form>
        )}
        {formError.fieldError("name") && (
          <p className="text-sm text-destructive">{formError.fieldError("name")}</p>
        )}
        {formError.general && (
          <p className="text-sm font-medium text-destructive">{formError.general}</p>
        )}
        {rowError && <p className="text-sm font-medium text-destructive">{rowError}</p>}

        {visible.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">{t("categories.empty")}</p>
        ) : (
          <ul className="flex max-h-[28rem] flex-col overflow-y-auto">
            {visible.map((category) =>
              editingId === category.id ? (
                <li
                  key={category.id}
                  className="flex items-center gap-2 border-b py-2 last:border-b-0"
                >
                  <Input
                    autoFocus
                    type="text"
                    className="h-8 flex-1"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveEdit(category.id);
                      if (e.key === "Escape") cancelEdit();
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={savingEdit}
                    onClick={() => handleSaveEdit(category.id)}
                  >
                    {savingEdit ? t("common.saving") : t("common.save")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={savingEdit}
                    onClick={cancelEdit}
                  >
                    {t("common.cancel")}
                  </Button>
                </li>
              ) : (
                <li
                  key={category.id}
                  className="flex items-center gap-3 border-b py-2 text-sm transition-colors last:border-b-0 hover:bg-muted/50"
                >
                  <span className="min-w-0 flex-1 truncate">{category.name}</span>
                  <Badge variant={category.is_active ? "success" : "destructive"}>
                    {category.is_active ? t("common.active") : t("common.archived")}
                  </Badge>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      title={t("common.edit")}
                      onClick={() => startEdit(category)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      title={category.is_active ? t("common.archive") : t("common.reactivate")}
                      onClick={() => handleArchiveToggle(category)}
                    >
                      {category.is_active ? (
                        <Archive className="size-3.5" />
                      ) : (
                        <ArchiveRestore className="size-3.5" />
                      )}
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
                          <AlertDialogTitle>
                            {t("common.deleteConfirmTitle").replace("{name}", category.name)}
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            {deleteConfirmBody} {t("common.deleteCannotBeUndone")}
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
                </li>
              ),
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
