# /history — custom date range within "الشهر"

## Problem
`/history` (SaleHistoryScreen) only offers اليوم / الأسبوع / الشهر via the shared
`PeriodToggle`. The owner has no way to browse a specific date range (e.g. a
particular week last month).

## Approach
Mirror the existing pattern already shipped on `/expenses`
(`ExpenseListPage.vue`'s `month-date-bar`): when "الشهر" is the active period,
show two inline date pickers ("من" / "إلى") that narrow the range. No changes
to the shared `PeriodToggle` component or `usePeriodToggle` singleton — Home,
Expenses, Audit Log, and Cash Drawer are unaffected.

## Behavior
- `PeriodToggle` stays 3 options (اليوم / الأسبوع / الشهر). No 4th "custom" tab.
- When `period === 'month'`, two `AppDatePicker` fields appear next to the
  toggle: "من" and "إلى". Local `ref<string>` state (`filterStart`,
  `filterEnd`), ISO `yyyy-mm-dd` strings, same `isoToDate`/`dateToIso` helpers
  already used in `ExpenseListPage.vue`.
- Effective range for `loadHistory()`:
  - Neither date set → `getDateRange('month')` (1st of month → today), same
    as today.
  - Either set → the picked date overrides that boundary; the other falls
    back to the month default. If start ends up after end, they're swapped
    (same guard as Expenses).
- A "مسح" (clear) button appears next to the pickers whenever either date is
  set; clicking it resets both and reloads the plain month range.
- Switching to اليوم / الأسبوع clears `filterStart`/`filterEnd` and reloads
  that period's range (matches Expenses' `reload()`).
- Picking a date immediately triggers a reload (`@update:model-value="reload"`
  wired the same way as Expenses).
- `canViewReports` gating is unchanged — reports-less operators never see the
  period toggle or these date pickers (WAFI-058).

## Non-goals
- No changes to `PeriodToggle.vue`, `usePeriodToggle.ts`, or `periodUtils.ts`'s
  `Period`/`getDateRange`. `getDateRange('month')` remains the fallback.
- No new composable — logic lives inline in `SaleHistoryScreen.vue`, same
  scope as `ExpenseListPage.vue`.
- Doesn't touch the `?period=` URL query drill-down behavior (`isPeriodDrillDown`),
  which is unrelated to this in-page date narrowing.

## Testing
- Unit test (Vitest, mirrors `useExpenses.test.ts` date-range assertions if
  any exist) or component test asserting: selecting "الشهر" + custom من/إلى
  calls `loadHistory` with the picked range; clearing reverts to
  `getDateRange('month')`; switching period away from "الشهر" clears the
  custom dates.
