import { renderDashboardClientCore } from "./dashboard-html-client-core.js";
import { DASHBOARD_CLIENT_DETAIL } from "./dashboard-html-client-detail.js";
import { DASHBOARD_CLIENT_JOBS } from "./dashboard-html-client-jobs.js";
import { DASHBOARD_CLIENT_REPORTS } from "./dashboard-html-client-reports.js";

export function renderDashboardClientScript(runnerAvailable: boolean, analystAvailable: boolean, planningAvailable: boolean): string {
  return [
    renderDashboardClientCore(runnerAvailable, analystAvailable, planningAvailable),
    DASHBOARD_CLIENT_JOBS,
    DASHBOARD_CLIENT_DETAIL,
    DASHBOARD_CLIENT_REPORTS,
  ].join("\n\n");
}
