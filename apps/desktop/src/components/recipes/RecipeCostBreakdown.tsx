import type { CostBreakdown } from "@pastry-management/core";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

/** Format money the same way RawMaterialDetail.tsx does: whole-currency amounts to 2 decimals,
 * very small per-base-unit figures to 4 so fractions-of-a-cent costs remain visible. */
function formatMoney(micros: number, digits = 2): string {
  return (micros / 1_000_000).toFixed(digits);
}

interface RecipeCostBreakdownProps {
  breakdown: CostBreakdown;
}

/**
 * Renders a cost breakdown per docs/costing-engine.md §4/§12.4's format: a table of ingredient
 * name / quantity+unit / line cost, then total cost, yield, and cost per yield unit below it.
 *
 * `CostLine.subBreakdown` is recursive (a sub-recipe ingredient's own breakdown, which can itself
 * have sub-recipe ingredients), so this component renders itself for each nested breakdown, inside
 * a collapsible `<details>` so deep graphs don't overwhelm the page by default.
 */
export function RecipeCostBreakdown({ breakdown }: RecipeCostBreakdownProps) {
  const nestedLines = breakdown.lines.filter((line) => line.subBreakdown);

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ingredient</TableHead>
              <TableHead>Quantity</TableHead>
              <TableHead>Line cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {breakdown.lines.map((line, idx) => (
              <TableRow key={`${line.ingredientType}-${line.ingredientId}-${idx}`}>
                <TableCell>{line.name}</TableCell>
                <TableCell>
                  {line.quantity} {line.unit}
                </TableCell>
                <TableCell>€{formatMoney(line.lineCostMicros)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="font-medium text-muted-foreground">Total cost</dt>
        <dd className="font-semibold">€{formatMoney(breakdown.totalCostMicros)}</dd>
        <dt className="font-medium text-muted-foreground">Yield</dt>
        <dd>
          {breakdown.yieldQuantity} {breakdown.yieldUnit}
        </dd>
        <dt className="font-medium text-muted-foreground">Cost per yield unit</dt>
        <dd className="font-semibold">€{formatMoney(breakdown.costPerYieldUnitMicros, 4)}</dd>
      </dl>

      {nestedLines.length > 0 && (
        <div className="mt-1 flex flex-col gap-2">
          {nestedLines.map((line, idx) => (
            <details
              key={`sub-${line.ingredientType}-${line.ingredientId}-${idx}`}
              className="rounded-lg border px-3 py-2"
            >
              <summary className="cursor-pointer text-sm font-medium">
                {line.name} — sub-recipe cost breakdown
              </summary>
              <div className="mt-3 border-l-2 pl-4">
                {line.subBreakdown && <RecipeCostBreakdown breakdown={line.subBreakdown} />}
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
