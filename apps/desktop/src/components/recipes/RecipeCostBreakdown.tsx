import type { CostBreakdown } from "@pastry-management/core";

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
    <div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Ingredient</th>
            <th>Quantity</th>
            <th>Line cost</th>
          </tr>
        </thead>
        <tbody>
          {breakdown.lines.map((line, idx) => (
            <tr key={`${line.ingredientType}-${line.ingredientId}-${idx}`}>
              <td>{line.name}</td>
              <td>
                {line.quantity} {line.unit}
              </td>
              <td>€{formatMoney(line.lineCostMicros)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="detail-summary">
        <dt>Total cost</dt>
        <dd>€{formatMoney(breakdown.totalCostMicros)}</dd>
        <dt>Yield</dt>
        <dd>
          {breakdown.yieldQuantity} {breakdown.yieldUnit}
        </dd>
        <dt>Cost per yield unit</dt>
        <dd>€{formatMoney(breakdown.costPerYieldUnitMicros, 4)}</dd>
      </dl>

      {nestedLines.length > 0 && (
        <div className="nested-breakdown">
          {nestedLines.map((line, idx) => (
            <details key={`sub-${line.ingredientType}-${line.ingredientId}-${idx}`}>
              <summary>{line.name} — sub-recipe cost breakdown</summary>
              <div className="nested-breakdown-body">
                {line.subBreakdown && <RecipeCostBreakdown breakdown={line.subBreakdown} />}
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
