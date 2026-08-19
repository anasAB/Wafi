// src/features/reports/index.ts
// WAFI-147A: the registration barrel. reportRegistry.ts cannot import the 13
// definition files itself (they import REPORT_DEFINITIONS from it -- circular).
// This file's only job is to import every definition file for its
// REPORT_DEFINITIONS[...] = {...} registration side-effect, then re-export
// the registry/types so ReportsListPage.vue and ReportDetailPage.vue have
// exactly one import path that's guaranteed to see a fully populated registry.
export * from './reportRegistry'
export * from './report.types'
import './definitions/dailyClosing'
import './definitions/cashFlow'
import './definitions/weeklySummary'
import './definitions/profitTrend'
import './definitions/employeeSummary'
import './definitions/discountReport'
import './definitions/returnsReport'
import './definitions/creditReport'
import './definitions/topCustomers'
import './definitions/topProducts'
import './definitions/inventoryHealth'
import './definitions/deadStock'
import './definitions/monthlyHealth'
