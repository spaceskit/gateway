export const DASHBOARD_CLIENT_REPORTS = `function renderRunDetail() {
  const element = document.getElementById('run-detail');
  const detail = selectedRunDetail;
  if (!detail) {
    element.innerHTML = '<div class="empty">Select a run to inspect live progress, matrix status, logs, and gateway traces.</div>';
    return;
  }

  const snapshotData = detail.snapshot || { layers: [], providerParity: [], schedulerEvalRuns: [], comparisons: [] };
  const narrative = detail.narrativeSummary;
  const html = []
  html.push('<div class="row-top"><div><div class="title">' + esc(detail.name) + '</div><div class="meta">' + esc(detail.id) + '<br>' + esc(detail.config.layers.join(', ')) + (detail.config.providers.length ? '<br>' + esc(detail.config.providers.join(', ')) : '') + '</div></div><div><span class="badge ' + badgeClass(detail.status) + '">' + esc(detail.status) + '</span></div></div>');
  html.push('<div class="actions">'
    + ((detail.status === 'queued' || detail.status === 'starting' || detail.status === 'running' || detail.status === 'cancelling')
      ? '<button class="danger" type="button" onclick="cancelRun(\\'' + detail.id + '\\')">Cancel</button>'
      : '')
    + ((detail.status === 'completed' || detail.status === 'failed' || detail.status === 'cancelled' || detail.status === 'interrupted')
      ? '<button type="button" onclick="retryRun(\\'' + detail.id + '\\')">Retry</button>'
      : '')
    + (detail.reportFilename ? '<button type="button" onclick="openRunReport(\\'' + detail.reportFilename + '\\')">Open report</button>' : '')
    + '</div>');
  html.push(renderNarrativeSummary(narrative, {
    headlineLabel: 'what happened',
    failureLabel: 'Why it failed',
    passedLabel: 'Passed',
    actionsLabel: 'Next actions',
  }));
  html.push('<div class="summary-grid">'
    + renderSummaryCard('layers', String(narrative.counts.layerCount), detail.config.layers.join(', '))
    + renderSummaryCard('active scenario', narrative.activityLabel, narrative.humanStatusLabel)
    + renderSummaryCard('failed scenarios', String(narrative.counts.failedScenarios), 'scenario-level failures')
    + renderSummaryCard('failed provider checks', String(narrative.counts.failedProviderChecks), 'provider parity failures')
    + renderSummaryCard('scheduler eval payloads', String(narrative.counts.schedulerEvalPayloads), 'captured eval records')
    + '</div>');
  if (snapshotData.message) {
    html.push('<div class="card"><div class="note">message</div><div class="title" style="margin-top:8px">' + esc(snapshotData.message) + '</div></div>');
  }
  html.push('<div class="section"><h3>Scenario Matrix</h3>' + renderLiveMatrix(snapshotData.layers || []) + '</div>');
  html.push('<div class="section"><h3>Provider Parity</h3>' + renderProviderParity(snapshotData.providerParity || []) + '</div>');
  html.push('<div class="section"><h3>Scheduler Eval Runs</h3>' + renderEvalRuns(snapshotData.schedulerEvalRuns || []) + '</div>');
  html.push('<div class="section"><h3>Comparisons</h3>' + renderComparisons(snapshotData.comparisons || []) + '</div>');
  html.push(renderDebugSection([
    { title: 'Runner Events', content: renderEventRows(detail.runnerEvents || []) },
    { title: 'Gateway Events', content: renderEventRows(detail.gatewayEvents || []) },
  ]));
  element.innerHTML = html.join('');
}

function renderReportListItem(report) {
  const active = selectedReportFilename === report.filename ? ' active' : '';
  const context = report.runContext && report.runContext.program ? report.runContext.program : 'Workbench run';
  return '<div class="row-card' + active + '">'
    + '<div class="row-top">'
    + '<div><div class="title">' + esc(report.timestamp) + '</div><div class="meta">' + esc(context) + '<br>' + esc(report.layers + ' layers · ' + report.scenarios + ' scenarios') + '</div></div>'
    + '<div><span class="badge ' + badgeClass(report.overall) + '">' + esc(report.humanStatusLabel) + '</span><div class="meta">' + report.duration_ms + 'ms</div></div>'
    + '</div>'
    + '<div class="meta">' + esc(report.headline) + '<br>' + esc(report.failedScenarios + ' failed scenarios · ' + report.failedProviderChecks + ' failed provider checks' + (report.evalRuns ? ' · ' + report.evalRuns + ' scheduler eval payloads' : '')) + '</div>'
    + '<div class="actions"><button type="button" onclick="fetchReport(\\'' + report.filename + '\\')">Open</button></div>'
    + '</div>';
}

function planningIssueCard(issue, kind) {
  const active = selectedPlanningTask && selectedPlanningTask.queueItemId === issue.queueItemId ? ' active' : '';
  return '<div class="row-card' + active + '">'
    + '<div class="row-top">'
    + '<div><div class="title">' + esc(issue.queueItemId) + '</div><div class="meta">queue #' + esc(issue.queueIndex) + ' · ' + esc(kind) + '<br>' + esc(issue.code || '') + '</div></div>'
    + '<span class="badge ' + (kind === 'warning' ? 'badge-skip' : 'badge-fail') + '">' + esc(kind) + '</span>'
    + '</div>'
    + '<div class="meta">' + esc(issue.message) + '</div>'
    + '<div class="actions"><button type="button" onclick="fetchPlanningTask(\\'' + issue.queueItemId + '\\')">Open task</button></div>'
    + '</div>';
}

function renderPlanning() {
  const element = document.getElementById('planning-audit-list');
  if (!PLANNING_AVAILABLE) {
    element.innerHTML = '<div class="empty">Planning audit is unavailable in this mode.</div>';
    return;
  }
  if (!planningAudit) {
    element.innerHTML = '<div class="empty">Planning audit has not loaded yet.</div>';
    return;
  }
  const issues = []
    .concat((planningAudit.goalContractErrors || []).map((issue) => planningIssueCard(issue, 'error')))
    .concat((planningAudit.goalContractWarnings || []).map((issue) => planningIssueCard(issue, 'warning')))
    .concat((planningAudit.malformedVerificationBlocks || []).map((issue) => planningIssueCard(issue, 'error')))
    .concat((planningAudit.missingMachineReadableVerification || []).map((issue) => planningIssueCard(issue, 'error')));
  const summary = '<div class="summary-grid">'
    + renderSummaryCard('active task files', String(planningAudit.executableQueueItemCount || 0), planningAudit.repoRoot || '')
    + renderSummaryCard('contract errors', String((planningAudit.goalContractErrors || []).length), 'must be fixed')
    + renderSummaryCard('contract warnings', String((planningAudit.goalContractWarnings || []).length), 'drafts need review')
    + renderSummaryCard('verification gaps', String((planningAudit.missingMachineReadableVerification || []).length), 'review-only blockers')
    + renderSummaryCard('non-executable rows', String((planningAudit.nonExecutableRows || []).length), 'queue grouping/story rows')
    + '</div>';
  element.innerHTML = summary + (issues.length ? issues.join('') : '<div class="empty">No planning audit issues.</div>');
}

function renderPlanningTaskDetail() {
  const element = document.getElementById('planning-task-detail');
  if (!selectedPlanningTask) {
    element.innerHTML = '<div class="empty">Select a planning issue to inspect its task file.</div>';
    return;
  }
  element.innerHTML = '<div class="kv">'
    + '<div class="key">queueItemId</div><div class="value">' + esc(selectedPlanningTask.queueItemId) + '</div>'
    + '<div class="key">taskFilePath</div><div class="value">' + esc(selectedPlanningTask.taskFilePath) + '</div>'
    + '</div>'
    + '<div class="section"><h3>Markdown</h3><div class="event-row"><div class="detail">' + esc(selectedPlanningTask.markdown) + '</div></div></div>';
}

function renderReports() {
  const list = document.getElementById('report-list');
  list.innerHTML = reports.length
    ? reports.map(renderReportListItem).join('')
    : '<div class="empty">No reports found yet.</div>';
}

function renderReportDetail() {
  const report = selectedReport;
  const element = document.getElementById('report-detail');
  if (!report) {
    element.innerHTML = '<div class="empty">Select a saved report from the left.</div>';
    return;
  }

  const evalRuns = report.schedulerEvalRuns || [];
  const resolvedRuns = evalRuns.map(resolveEvalRun);
  const checkpointCount = resolvedRuns.reduce((sum, run) => sum + ((run.checkpoints || []).length), 0);
  const recommendationCount = resolvedRuns.reduce((sum, run) => sum + ((run.recommendations || []).length), 0);
  const narrative = report.narrativeSummary;
  const html = [];
  html.push('<div class="row-top"><div><div class="title">' + esc(report.timestamp) + '</div><div class="meta">' + esc((report.runContext && report.runContext.program) || 'Workbench run') + '</div></div><div><span class="badge ' + badgeClass(report.overall) + '">' + esc(report.overall) + '</span></div></div>');
  html.push(renderNarrativeSummary(narrative, {
    headlineLabel: 'what happened',
    failureLabel: 'Why it failed',
    passedLabel: 'Passed',
    actionsLabel: 'Next actions',
  }));
  html.push('<div class="summary-grid">'
    + renderSummaryCard('layers', String(narrative.counts.layerCount), narrative.counts.scenarioCount + ' scenarios')
    + renderSummaryCard('active scenario', narrative.activityLabel, narrative.humanStatusLabel)
    + renderSummaryCard('failed scenarios', String(narrative.counts.failedScenarios), 'historical view')
    + renderSummaryCard('failed provider checks', String(narrative.counts.failedProviderChecks), 'historical view')
    + renderSummaryCard('scheduler eval payloads', String(narrative.counts.schedulerEvalPayloads), checkpointCount + ' checkpoints · ' + recommendationCount + ' recommendations')
    + '</div>');
  html.push('<div class="section"><h3>Scenario Matrix</h3>' + renderLiveMatrix((report.layers || []).map((layer) => ({ name: layer.name, status: layer.status, durationMs: layer.duration_ms, scenarios: (layer.scenarios || []).map((scenario) => ({ name: scenario.name, status: scenario.status, durationMs: scenario.duration_ms, error: scenario.error })) }))) + '</div>');
  if (report.providerParity && report.providerParity.length) {
    html.push('<div class="section"><h3>Provider Parity</h3>' + renderProviderParity(report.providerParity) + '</div>');
  }
  if (evalRuns.length) {
    html.push('<div class="section"><h3>Scheduler Eval Runs</h3>' + renderEvalRuns(evalRuns) + '</div>');
  }
  if (report.comparisons && report.comparisons.length) {
    html.push('<div class="section"><h3>Comparisons</h3>' + renderComparisons(report.comparisons) + '</div>');
  }
  element.innerHTML = html.join('');
}

function startReportPolling() {
  if (reportsPollTimer) clearInterval(reportsPollTimer);
  reportsPollTimer = setInterval(() => { void fetchReports(); }, 15000);
}

document.addEventListener('DOMContentLoaded', () => {
  switchTab('jobs');
  void fetchReports();
  if (PLANNING_AVAILABLE) {
    void fetchPlanningAudit();
  }
  if (ANALYST_AVAILABLE) {
    void fetchAnalystSnapshot();
  }
  if (RUNNER_AVAILABLE) {
    void fetchSnapshot();
    connectJobsWs();
  } else {
    document.getElementById('ws-status').textContent = 'ws unavailable';
    renderJobs();
  }
  startReportPolling();
});`;
