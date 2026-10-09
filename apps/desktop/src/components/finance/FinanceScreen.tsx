import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import * as expenseCategoriesApi from "../../api/expenseCategories";
import * as expensesApi from "../../api/expenses";
import * as incomeCategoriesApi from "../../api/incomeCategories";
import * as incomeEntriesApi from "../../api/incomeEntries";
import type {
  Category,
  Expense,
  ExpenseInput,
  IncomeEntry,
  IncomeEntryInput,
} from "../../api/types";
import { availableFinanceYears, summarizeByMonth, totalsForYear } from "../../lib/finance";
import { useI18n } from "../../lib/i18n";
import { compareNullable } from "../../lib/sorting";
import { FinanceEntryForm } from "./FinanceEntryForm";
import type { FinanceEntryValues } from "./FinanceEntryForm";
import { FinanceEntryTable } from "./FinanceEntryTable";
import type { FinanceEntryRow } from "./FinanceEntryTable";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Skeleton } from "../ui/skeleton";
import { ListToolbar } from "../shared/ListToolbar";
import type { ListToolbarFilter } from "../shared/ListToolbar";

type Panel =
  | { mode: "closed" }
  | { mode: "create-expense" }
  | { mode: "edit-expense"; expense: Expense }
  | { mode: "create-income" }
  | { mode: "edit-income"; entry: IncomeEntry };

type SortField = "date" | "amount" | "category";

const NO_COMPARISON = "__none__";

function formatMoney(micros: number): string {
  return (micros / 1_000_000).toFixed(2);
}

function monthLabel(month: number, locale: string): string {
  return new Date(2000, month - 1, 1).toLocaleDateString(locale === "el" ? "el-GR" : "en-US", {
    month: "short",
  });
}

/**
 * Finance — expense/income logging, independent from the costing side of the app (which only
 * ever tracked ingredient cost, never actual shop revenue or non-ingredient spending). Shows a
 * monthly income/expense/balance chart for a selected year, an optional side-by-side comparison
 * against a second year, and two searchable/sortable/filterable ledgers (see ListToolbar).
 *
 * Everything — monthly totals, year comparison, search/filter/sort — is computed client-side over
 * the full expense/income lists (see api/expenses.ts), the same division of labor the costing
 * engine and Analytics screen already use.
 */
export function FinanceScreen() {
  const { t, te, locale } = useI18n();

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [incomeEntries, setIncomeEntries] = useState<IncomeEntry[]>([]);
  const [expenseCategories, setExpenseCategories] = useState<Category[]>([]);
  const [incomeCategories, setIncomeCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>({ mode: "closed" });

  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [compareYear, setCompareYear] = useState<number | null>(null);

  const [expenseSearch, setExpenseSearch] = useState("");
  const [expenseCategoryFilter, setExpenseCategoryFilter] = useState("");
  const [expenseMonthFilter, setExpenseMonthFilter] = useState("");
  const [expenseSortField, setExpenseSortField] = useState<SortField>("date");
  const [expenseSortDirection, setExpenseSortDirection] = useState<"asc" | "desc">("desc");

  const [incomeSearch, setIncomeSearch] = useState("");
  const [incomeCategoryFilter, setIncomeCategoryFilter] = useState("");
  const [incomeMonthFilter, setIncomeMonthFilter] = useState("");
  const [incomeSortField, setIncomeSortField] = useState<SortField>("date");
  const [incomeSortDirection, setIncomeSortDirection] = useState<"asc" | "desc">("desc");

  const refresh = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    Promise.all([
      expensesApi.listExpenses(),
      incomeEntriesApi.listIncomeEntries(),
      expenseCategoriesApi.listExpenseCategories(false),
      incomeCategoriesApi.listIncomeCategories(false),
    ])
      .then(([expensesResult, incomeResult, expenseCategoriesResult, incomeCategoriesResult]) => {
        setExpenses(expensesResult);
        setIncomeEntries(incomeResult);
        setExpenseCategories(expenseCategoriesResult);
        setIncomeCategories(incomeCategoriesResult);
      })
      .catch((err) => setLoadError(te(err)))
      .finally(() => setLoading(false));
  }, [te]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const years = useMemo(
    () => availableFinanceYears(expenses, incomeEntries),
    [expenses, incomeEntries],
  );

  const monthlyData = useMemo(() => {
    const months = summarizeByMonth(expenses, incomeEntries, selectedYear);
    return months.map((m) => ({
      month: monthLabel(m.month, locale),
      income: m.incomeMicros / 1_000_000,
      expense: m.expenseMicros / 1_000_000,
      balance: m.balanceMicros / 1_000_000,
    }));
  }, [expenses, incomeEntries, selectedYear, locale]);

  const yearTotals = useMemo(
    () => totalsForYear(expenses, incomeEntries, selectedYear),
    [expenses, incomeEntries, selectedYear],
  );
  const compareTotals = useMemo(
    () => (compareYear != null ? totalsForYear(expenses, incomeEntries, compareYear) : null),
    [expenses, incomeEntries, compareYear],
  );

  function percentChange(current: number, previous: number): string {
    if (previous === 0) return current === 0 ? "0%" : "—";
    const pct = ((current - previous) / Math.abs(previous)) * 100;
    return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
  }

  async function handleCreateExpense(values: FinanceEntryValues) {
    const input: ExpenseInput = {
      expense_date: values.date,
      category_id: values.category_id,
      amount_micros: values.amount_micros,
      description: values.description,
    };
    await expensesApi.createExpense(input);
    setPanel({ mode: "closed" });
    refresh();
  }

  async function handleUpdateExpense(id: number, values: FinanceEntryValues) {
    const input: ExpenseInput = {
      expense_date: values.date,
      category_id: values.category_id,
      amount_micros: values.amount_micros,
      description: values.description,
    };
    await expensesApi.updateExpense(id, input);
    setPanel({ mode: "closed" });
    refresh();
  }

  async function handleDeleteExpense(id: number) {
    setRowError(null);
    try {
      await expensesApi.deleteExpense(id);
      refresh();
    } catch (err) {
      setRowError(te(err));
    }
  }

  async function handleCreateIncome(values: FinanceEntryValues) {
    const input: IncomeEntryInput = {
      income_date: values.date,
      category_id: values.category_id,
      amount_micros: values.amount_micros,
      description: values.description,
    };
    await incomeEntriesApi.createIncomeEntry(input);
    setPanel({ mode: "closed" });
    refresh();
  }

  async function handleUpdateIncome(id: number, values: FinanceEntryValues) {
    const input: IncomeEntryInput = {
      income_date: values.date,
      category_id: values.category_id,
      amount_micros: values.amount_micros,
      description: values.description,
    };
    await incomeEntriesApi.updateIncomeEntry(id, input);
    setPanel({ mode: "closed" });
    refresh();
  }

  async function handleDeleteIncome(id: number) {
    setRowError(null);
    try {
      await incomeEntriesApi.deleteIncomeEntry(id);
      refresh();
    } catch (err) {
      setRowError(te(err));
    }
  }

  const monthOptions = Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1),
    label: monthLabel(i + 1, locale),
  }));

  const visibleExpenses = useMemo(() => {
    const query = expenseSearch.trim().toLowerCase();
    const filtered = expenses.filter((e) => {
      if (e.expense_date.slice(0, 4) !== String(selectedYear)) return false;
      if (
        expenseMonthFilter !== "" &&
        e.expense_date.slice(5, 7) !== expenseMonthFilter.padStart(2, "0")
      ) {
        return false;
      }
      if (expenseCategoryFilter !== "" && String(e.category_id) !== expenseCategoryFilter)
        return false;
      if (query !== "") {
        const haystack = `${e.description ?? ""} ${e.category_name ?? ""}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
    const sortKey = (e: Expense): string | number | null => {
      switch (expenseSortField) {
        case "date":
          return e.expense_date;
        case "amount":
          return e.amount_micros;
        case "category":
          return e.category_name;
      }
    };
    return [...filtered].sort((a, b) =>
      compareNullable(sortKey(a), sortKey(b), expenseSortDirection),
    );
  }, [
    expenses,
    selectedYear,
    expenseSearch,
    expenseCategoryFilter,
    expenseMonthFilter,
    expenseSortField,
    expenseSortDirection,
  ]);

  const visibleIncome = useMemo(() => {
    const query = incomeSearch.trim().toLowerCase();
    const filtered = incomeEntries.filter((e) => {
      if (e.income_date.slice(0, 4) !== String(selectedYear)) return false;
      if (
        incomeMonthFilter !== "" &&
        e.income_date.slice(5, 7) !== incomeMonthFilter.padStart(2, "0")
      ) {
        return false;
      }
      if (incomeCategoryFilter !== "" && String(e.category_id) !== incomeCategoryFilter)
        return false;
      if (query !== "") {
        const haystack = `${e.description ?? ""} ${e.category_name ?? ""}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
    const sortKey = (e: IncomeEntry): string | number | null => {
      switch (incomeSortField) {
        case "date":
          return e.income_date;
        case "amount":
          return e.amount_micros;
        case "category":
          return e.category_name;
      }
    };
    return [...filtered].sort((a, b) =>
      compareNullable(sortKey(a), sortKey(b), incomeSortDirection),
    );
  }, [
    incomeEntries,
    selectedYear,
    incomeSearch,
    incomeCategoryFilter,
    incomeMonthFilter,
    incomeSortField,
    incomeSortDirection,
  ]);

  const sortOptions = [
    { value: "date", label: t("common.date") },
    { value: "amount", label: t("finance.amount") },
    { value: "category", label: t("common.category") },
  ];

  const expenseFilters: ListToolbarFilter[] = [
    {
      key: "category",
      label: t("common.category"),
      value: expenseCategoryFilter,
      onChange: setExpenseCategoryFilter,
      options: [
        { value: "", label: t("common.allCategories") },
        ...expenseCategories.map((c) => ({ value: String(c.id), label: c.name })),
      ],
    },
    {
      key: "month",
      label: t("finance.month"),
      value: expenseMonthFilter,
      onChange: setExpenseMonthFilter,
      options: [{ value: "", label: t("finance.allMonths") }, ...monthOptions],
    },
  ];

  const incomeFilters: ListToolbarFilter[] = [
    {
      key: "category",
      label: t("common.category"),
      value: incomeCategoryFilter,
      onChange: setIncomeCategoryFilter,
      options: [
        { value: "", label: t("common.allCategories") },
        ...incomeCategories.map((c) => ({ value: String(c.id), label: c.name })),
      ],
    },
    {
      key: "month",
      label: t("finance.month"),
      value: incomeMonthFilter,
      onChange: setIncomeMonthFilter,
      options: [{ value: "", label: t("finance.allMonths") }, ...monthOptions],
    },
  ];

  const expenseRows: FinanceEntryRow[] = visibleExpenses.map((e) => ({
    id: e.id,
    date: e.expense_date,
    categoryName: e.category_name,
    amountMicros: e.amount_micros,
    description: e.description,
  }));
  const incomeRows: FinanceEntryRow[] = visibleIncome.map((e) => ({
    id: e.id,
    date: e.income_date,
    categoryName: e.category_name,
    amountMicros: e.amount_micros,
    description: e.description,
  }));

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="font-heading text-xl font-semibold">{t("finance.title")}</h2>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setPanel({ mode: "create-expense" })}
          >
            {t("finance.addExpense")}
          </Button>
          <Button type="button" onClick={() => setPanel({ mode: "create-income" })}>
            {t("finance.addIncome")}
          </Button>
        </div>
      </div>

      {loadError && <p className="text-sm font-medium text-destructive">{loadError}</p>}
      {rowError && <p className="text-sm font-medium text-destructive">{rowError}</p>}

      {(panel.mode === "create-expense" || panel.mode === "edit-expense") && (
        <Card>
          <CardHeader>
            <CardTitle>
              {panel.mode === "edit-expense" ? t("finance.editExpense") : t("finance.addExpense")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <FinanceEntryForm
              categories={expenseCategories}
              initial={
                panel.mode === "edit-expense"
                  ? {
                      date: panel.expense.expense_date,
                      category_id: panel.expense.category_id,
                      amount_micros: panel.expense.amount_micros,
                      description: panel.expense.description,
                    }
                  : undefined
              }
              onSubmit={(values) =>
                panel.mode === "edit-expense"
                  ? handleUpdateExpense(panel.expense.id, values)
                  : handleCreateExpense(values)
              }
              onCancel={() => setPanel({ mode: "closed" })}
            />
          </CardContent>
        </Card>
      )}

      {(panel.mode === "create-income" || panel.mode === "edit-income") && (
        <Card>
          <CardHeader>
            <CardTitle>
              {panel.mode === "edit-income" ? t("finance.editIncome") : t("finance.addIncome")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <FinanceEntryForm
              categories={incomeCategories}
              initial={
                panel.mode === "edit-income"
                  ? {
                      date: panel.entry.income_date,
                      category_id: panel.entry.category_id,
                      amount_micros: panel.entry.amount_micros,
                      description: panel.entry.description,
                    }
                  : undefined
              }
              onSubmit={(values) =>
                panel.mode === "edit-income"
                  ? handleUpdateIncome(panel.entry.id, values)
                  : handleCreateIncome(values)
              }
              onCancel={() => setPanel({ mode: "closed" })}
            />
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">{t("finance.year")}</span>
          <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">{t("finance.compareWith")}</span>
          <Select
            value={compareYear == null ? NO_COMPARISON : String(compareYear)}
            onValueChange={(v) => setCompareYear(v === NO_COMPARISON ? null : Number(v))}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_COMPARISON}>{t("finance.noComparison")}</SelectItem>
              {years
                .filter((y) => y !== selectedYear)
                .map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">
              {t("finance.totalIncome")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <p className="text-2xl font-semibold text-green-700 dark:text-green-400">
                €{formatMoney(yearTotals.incomeMicros)}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">
              {t("finance.totalExpenses")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <p className="text-2xl font-semibold text-destructive">
                €{formatMoney(yearTotals.expenseMicros)}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">{t("finance.balance")}</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <p
                className={`text-2xl font-semibold ${yearTotals.balanceMicros >= 0 ? "text-green-700 dark:text-green-400" : "text-destructive"}`}
              >
                €{formatMoney(yearTotals.balanceMicros)}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {compareTotals && (
        <Card>
          <CardHeader>
            <CardTitle>
              {t("finance.comparisonTitle")} — {selectedYear} {t("finance.vs")} {compareYear}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 text-sm">
              <div>
                <p className="text-muted-foreground">{t("finance.totalIncome")}</p>
                <p className="font-medium">
                  €{formatMoney(yearTotals.incomeMicros)} vs €
                  {formatMoney(compareTotals.incomeMicros)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {percentChange(yearTotals.incomeMicros, compareTotals.incomeMicros)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">{t("finance.totalExpenses")}</p>
                <p className="font-medium">
                  €{formatMoney(yearTotals.expenseMicros)} vs €
                  {formatMoney(compareTotals.expenseMicros)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {percentChange(yearTotals.expenseMicros, compareTotals.expenseMicros)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">{t("finance.balance")}</p>
                <p className="font-medium">
                  €{formatMoney(yearTotals.balanceMicros)} vs €
                  {formatMoney(compareTotals.balanceMicros)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {percentChange(yearTotals.balanceMicros, compareTotals.balanceMicros)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("finance.monthlyChartTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-72 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={(v: number) => `€${v.toFixed(0)}`} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(value) => `€${Number(value).toFixed(2)}`} />
                <Legend />
                <Bar
                  dataKey="income"
                  name={t("finance.totalIncome")}
                  fill="#16a34a"
                  radius={[3, 3, 0, 0]}
                />
                <Bar
                  dataKey="expense"
                  name={t("finance.totalExpenses")}
                  fill="var(--destructive)"
                  radius={[3, 3, 0, 0]}
                />
                <Line
                  type="monotone"
                  dataKey="balance"
                  name={t("finance.balance")}
                  stroke="var(--primary)"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("finance.expensesTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <ListToolbar
              searchValue={expenseSearch}
              onSearchChange={setExpenseSearch}
              searchPlaceholder={t("finance.searchPlaceholder")}
              filters={expenseFilters}
              sortOptions={sortOptions}
              sortValue={expenseSortField}
              onSortChange={(v) => setExpenseSortField(v as SortField)}
              sortDirection={expenseSortDirection}
              onToggleSortDirection={() =>
                setExpenseSortDirection((d) => (d === "asc" ? "desc" : "asc"))
              }
              sortLabel={t("common.sortBy")}
            />
            {loading ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <FinanceEntryTable
                rows={expenseRows}
                emptyMessage={
                  expenses.length === 0 ? t("finance.noExpensesYet") : t("common.noMatches")
                }
                sign="-"
                onEdit={(id) => {
                  const expense = expenses.find((e) => e.id === id);
                  if (expense) setPanel({ mode: "edit-expense", expense });
                }}
                onDelete={handleDeleteExpense}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("finance.incomeTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <ListToolbar
              searchValue={incomeSearch}
              onSearchChange={setIncomeSearch}
              searchPlaceholder={t("finance.searchPlaceholder")}
              filters={incomeFilters}
              sortOptions={sortOptions}
              sortValue={incomeSortField}
              onSortChange={(v) => setIncomeSortField(v as SortField)}
              sortDirection={incomeSortDirection}
              onToggleSortDirection={() =>
                setIncomeSortDirection((d) => (d === "asc" ? "desc" : "asc"))
              }
              sortLabel={t("common.sortBy")}
            />
            {loading ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <FinanceEntryTable
                rows={incomeRows}
                emptyMessage={
                  incomeEntries.length === 0 ? t("finance.noIncomeYet") : t("common.noMatches")
                }
                sign="+"
                onEdit={(id) => {
                  const entry = incomeEntries.find((e) => e.id === id);
                  if (entry) setPanel({ mode: "edit-income", entry });
                }}
                onDelete={handleDeleteIncome}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
