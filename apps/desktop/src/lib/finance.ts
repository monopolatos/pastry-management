import type { Expense, IncomeEntry } from "../api/types";

/**
 * Pure aggregation helpers for the Finance screen — all client-side over the full
 * expenses/income lists (see api/expenses.ts's doc comment for why there's no backend
 * filtering), mirroring how the costing engine and Analytics screen already do their math in
 * TypeScript rather than SQL.
 *
 * Dates are plain `"YYYY-MM-DD"` strings (from `<input type="date">`). Parsed by splitting the
 * string, not via `new Date(iso)` + `.getFullYear()`/`.getMonth()` — those read back in the
 * browser's local timezone, which can shift a date near a UTC day boundary into the wrong
 * month/year for users west of UTC. Splitting the string sidesteps that entirely.
 */

export interface MonthlyFinanceSummary {
  /** 1-12 */
  month: number;
  incomeMicros: number;
  expenseMicros: number;
  balanceMicros: number;
}

export interface YearTotals {
  incomeMicros: number;
  expenseMicros: number;
  balanceMicros: number;
}

function yearOf(isoDate: string): number {
  return Number(isoDate.slice(0, 4));
}

function monthOf(isoDate: string): number {
  return Number(isoDate.slice(5, 7));
}

export function summarizeByMonth(
  expenses: Expense[],
  income: IncomeEntry[],
  year: number,
): MonthlyFinanceSummary[] {
  const months: MonthlyFinanceSummary[] = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    incomeMicros: 0,
    expenseMicros: 0,
    balanceMicros: 0,
  }));

  for (const expense of expenses) {
    if (yearOf(expense.expense_date) !== year) continue;
    months[monthOf(expense.expense_date) - 1].expenseMicros += expense.amount_micros;
  }
  for (const entry of income) {
    if (yearOf(entry.income_date) !== year) continue;
    months[monthOf(entry.income_date) - 1].incomeMicros += entry.amount_micros;
  }
  for (const m of months) {
    m.balanceMicros = m.incomeMicros - m.expenseMicros;
  }
  return months;
}

export function totalsForYear(
  expenses: Expense[],
  income: IncomeEntry[],
  year: number,
): YearTotals {
  return summarizeByMonth(expenses, income, year).reduce(
    (acc, m) => ({
      incomeMicros: acc.incomeMicros + m.incomeMicros,
      expenseMicros: acc.expenseMicros + m.expenseMicros,
      balanceMicros: acc.balanceMicros + m.balanceMicros,
    }),
    { incomeMicros: 0, expenseMicros: 0, balanceMicros: 0 },
  );
}

/** Every year with at least one expense or income entry, plus the current year (so a brand new,
 * empty shop still has somewhere to start logging), newest first. */
export function availableFinanceYears(expenses: Expense[], income: IncomeEntry[]): number[] {
  const years = new Set<number>([new Date().getFullYear()]);
  for (const expense of expenses) years.add(yearOf(expense.expense_date));
  for (const entry of income) years.add(yearOf(entry.income_date));
  return [...years].sort((a, b) => b - a);
}
