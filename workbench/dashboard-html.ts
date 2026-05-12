import { renderDashboardBody } from "./dashboard-html-body.js";
import { renderDashboardClientScript } from "./dashboard-html-client.js";
import { DASHBOARD_STYLE } from "./dashboard-html-style.js";

export function renderDashboardHtml(runnerAvailable: boolean, analystAvailable: boolean, planningAvailable: boolean): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Workbench Live Runner</title>
<style>
${DASHBOARD_STYLE}
</style>${renderDashboardBody(runnerAvailable, analystAvailable, planningAvailable)}<script>
${renderDashboardClientScript(runnerAvailable, analystAvailable, planningAvailable)}
</script>
</body>
</html>`;
}
