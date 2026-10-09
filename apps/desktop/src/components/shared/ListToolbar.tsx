import { ArrowDownAZ, ArrowUpAZ, Search, X } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

export interface ListToolbarOption {
  value: string;
  label: string;
}

/** Radix's Select doesn't allow an item value of `""` (reserved to mean "no selection"), so a
 * filter's "All" option (value `""`) is represented by this sentinel on the wire and translated
 * back to `""` before reaching the caller's `onChange`. */
const ALL_VALUE = "__all__";

export interface ListToolbarFilter {
  key: string;
  label: string;
  value: string;
  /** First entry is typically "All" (value `""`). */
  options: ListToolbarOption[];
  onChange: (value: string) => void;
}

interface ListToolbarProps {
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  filters: ListToolbarFilter[];
  sortOptions: ListToolbarOption[];
  sortValue: string;
  onSortChange: (value: string) => void;
  sortDirection: "asc" | "desc";
  onToggleSortDirection: () => void;
  sortLabel: string;
}

/**
 * Shared search/filter/sort bar for the Raw Materials and Recipes list screens — same shape in
 * both places (a name search, one or two category/status-style dropdown filters, and a sort field
 * + direction toggle), so it's one reusable, consistently-styled component rather than two
 * screens independently rebuilding the same bar with subtly different spacing/icons.
 *
 * Deliberately presentational only: each screen owns its own search/filter/sort state and does
 * the actual filtering/sorting of its list client-side (the data is already fully loaded, so
 * there's no backend round trip involved in any of this).
 */
export function ListToolbar({
  searchValue,
  onSearchChange,
  searchPlaceholder,
  filters,
  sortOptions,
  sortValue,
  onSortChange,
  sortDirection,
  onToggleSortDirection,
  sortLabel,
}: ListToolbarProps) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/30 p-3">
      <div className="flex min-w-[220px] flex-1 flex-col gap-1.5">
        <Label htmlFor="list-toolbar-search" className="text-xs text-muted-foreground">
          {searchPlaceholder}
        </Label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="list-toolbar-search"
            type="text"
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="pl-8 pr-8"
          />
          {searchValue !== "" && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>

      {filters.map((filter) => (
        <div key={filter.key} className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">{filter.label}</Label>
          <Select
            value={filter.value === "" ? ALL_VALUE : filter.value}
            onValueChange={(v) => filter.onChange(v === ALL_VALUE ? "" : v)}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {filter.options.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value === "" ? ALL_VALUE : option.value}
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">{sortLabel}</Label>
        <div className="flex gap-1.5">
          <Select value={sortValue} onValueChange={onSortChange}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sortOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="icon"
            title={sortDirection === "asc" ? "A → Z" : "Z → A"}
            onClick={onToggleSortDirection}
          >
            {sortDirection === "asc" ? (
              <ArrowUpAZ className="size-4" />
            ) : (
              <ArrowDownAZ className="size-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
