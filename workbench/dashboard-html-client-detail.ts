export const DASHBOARD_CLIENT_DETAIL = `function renderSummaryCard(label, value, hint) {
  return '<div class="summary-card">'
    + '<div class="label">' + esc(label) + '</div>'
    + '<div class="value">' + esc(value) + '</div>'
    + (hint ? '<div class="hint">' + esc(hint) + '</div>' : '')
    + '</div>';
}

function renderTextList(items, emptyText) {
  if (!items || !items.length) {
    return '<div class="empty">' + esc(emptyText) + '</div>';
  }
  return '<div class="event-list">' + items.map((item) =>
    '<div class="event-row"><div class="detail" style="margin-top:0">' + esc(item) + '</div></div>'
  ).join('') + '</div>';
}

function renderNarrativeSummary(summary, options) {
  if (!summary) {
    return "";
  }
  const headlineLabel = options && options.headlineLabel ? options.headlineLabel : 'what happened';
  const failureLabel = options && options.failureLabel ? options.failureLabel : 'Why it failed';
  const passedLabel = options && options.passedLabel ? options.passedLabel : 'Passed';
  const actionsLabel = options && options.actionsLabel ? options.actionsLabel : 'Next actions';
  const statusClass = summary.humanStatusLabel && summary.humanStatusLabel.toLowerCase().includes('fail')
    ? 'fail'
    : summary.humanStatusLabel && summary.humanStatusLabel.toLowerCase().includes('interrupt')
      ? 'skip'
      : 'pass';
  return ''
    + '<div class="card narrative-card">'
    + '<div class="note">' + esc(headlineLabel) + '</div>'
    + '<div class="row-top" style="margin-top:10px">'
    + '<div class="title">' + esc(summary.headline) + '</div>'
    + '<div><span class="badge badge-' + statusClass + '">' + esc(summary.humanStatusLabel) + '</span></div>'
    + '</div>'
    + (summary.diagnosisResult ? '<div class="meta" style="margin-top:8px">' + esc(summary.diagnosisResult) + '</div>' : '')
    + (summary.activityLabel ? '<div class="meta" style="margin-top:8px">active scenario: ' + esc(summary.activityLabel) + '</div>' : '')
    + '</div>'
    + '<div class="split section">'
    + '<div><h3>' + esc(failureLabel) + '</h3>' + renderTextList(summary.primaryFailures || [], 'No primary failures recorded.') + '</div>'
    + '<div><h3>' + esc(passedLabel) + '</h3>' + renderTextList(summary.passedAreas || [], 'No passing areas recorded.') + '</div>'
    + '</div>'
    + '<div class="section"><h3>' + esc(actionsLabel) + '</h3>' + renderTextList(summary.nextActions || [], 'No next actions suggested.') + '</div>';
}

function renderDebugSection(sections) {
  const renderedSections = (sections || [])
    .filter((section) => section && section.content)
    .map((section) => '<div><h3>' + esc(section.title) + '</h3>' + section.content + '</div>')
    .join('');
  if (!renderedSections) {
    return '';
  }
  return '<details class="section"><summary>Debug</summary><div class="details-body">' + renderedSections + '</div></details>';
}

function renderAnalyst() {
  renderAnalystQueue();
  renderAnalystRecent();
  renderAnalystDetail();
}

function renderAnalystDetail() {
  const element = document.getElementById('analyst-detail');
  const detail = selectedAnalystDetail;
  if (!detail) {
    element.innerHTML = '<div class="empty">Select an analyst session to inspect its evidence and fix proposal.</div>';
    return;
  }

  const proposal = detail.proposal;
  const verificationRows = (detail.snapshot.verificationCommands || []).map((command) =>
    '<tr><td>' + esc(command.command) + '</td><td><span class="badge ' + badgeClass(command.status) + '">' + esc(command.status) + '</span></td><td>' + esc(command.summary || command.outputPreview || '') + '</td></tr>'
  ).join('');
  const evidenceRows = (detail.snapshot.evidence || []).map((item) =>
    '<div class="event-row"><div class="topline"><div class="title">' + esc(item.title) + '</div></div><div class="detail">' + esc(item.detail) + '</div></div>'
  ).join('');
  const analystNarrative = {
    ...detail.narrativeSummary,
    passedAreas: detail.sourceRun && detail.sourceRun.narrativeSummary
      ? [detail.sourceRun.narrativeSummary.headline]
      : [],
  };

  element.innerHTML = ''
    + renderNarrativeSummary(analystNarrative, {
      headlineLabel: 'diagnosis result',
      failureLabel: 'Problems encountered',
      passedLabel: 'Source run result',
      actionsLabel: 'Next actions',
    })
    + '<div class="summary-grid">'
    + renderSummaryCard('result', detail.narrativeSummary ? detail.narrativeSummary.humanStatusLabel : detail.status, (detail.status === 'running' || detail.status === 'starting' || detail.status === 'queued') ? detail.phase : 'terminal session')
    + renderSummaryCard('source', detail.sourceType, detail.sourceRunId || detail.sourceSpaceId)
    + renderSummaryCard('source run', detail.sourceRun ? detail.sourceRun.status : 'n/a', detail.sourceRun && detail.sourceRun.narrativeSummary ? detail.sourceRun.narrativeSummary.headline : (detail.sourceRunId || ''))
    + renderSummaryCard('analysis space', detail.analysisSpaceId || 'n/a', detail.analysisRootTurnId || '')
    + renderSummaryCard('task', detail.taskId || 'n/a', detail.exitSummary || '')
    + renderSummaryCard('authority', detail.authority, formatDuration(detail.durationMs))
    + '</div>'
    + (proposal
      ? '<div class="card"><div class="kv">'
        + '<div class="key">summary</div><div class="value">' + esc(proposal.summary) + '</div>'
        + '<div class="key">rootCause</div><div class="value">' + esc(proposal.rootCause) + '</div>'
        + '<div class="key">reproductionCommands</div><div class="value">' + esc((proposal.reproductionCommands || []).join('\\n')) + '</div>'
        + '<div class="key">proposedEdits</div><div class="value">' + esc((proposal.proposedEdits || []).map((item) => item.filePath + ': ' + item.summary).join('\\n')) + '</div>'
        + '</div></div>'
      : '<div class="empty">No proposal saved yet.</div>')
    + '<div class="section"><h3>Verification Commands</h3>'
    + (verificationRows
      ? '<table class="matrix"><thead><tr><th>Command</th><th>Status</th><th>Summary</th></tr></thead><tbody>' + verificationRows + '</tbody></table>'
      : '<div class="empty">No verification commands recorded.</div>')
    + '</div>'
    + '<div class="section"><h3>Evidence</h3>' + (evidenceRows || '<div class="empty">No evidence recorded.</div>') + '</div>'
    + renderDebugSection([
      { title: 'Session Events', content: renderEventRows(detail.events || []) },
      { title: 'Gateway Events', content: renderEventRows(detail.gatewayEvents || []) },
    ]);
}

function renderLiveMatrix(layers) {
  const rows = [];
  for (const layer of layers || []) {
    const scenarios = layer.scenarios || [];
    if (!scenarios.length) {
      rows.push('<tr><td>' + esc(layer.name) + '</td><td class="muted">—</td><td><span class="badge ' + badgeClass(layer.status) + '">' + esc(layer.status) + '</span></td><td class="meta">' + formatDuration(layer.durationMs) + '</td><td></td></tr>');
    }
    for (const scenario of scenarios) {
      rows.push(
        '<tr>'
          + '<td><span class="badge ' + badgeClass(layer.status) + '">' + esc(layer.name) + '</span></td>'
          + '<td>' + esc(scenario.name) + '</td>'
          + '<td><span class="badge ' + badgeClass(scenario.status) + '">' + esc(scenario.status) + '</span></td>'
          + '<td class="meta">' + formatDuration(scenario.durationMs) + '</td>'
          + '<td>' + (scenario.error ? '<span class="muted">' + esc(scenario.error) + '</span>' : '<span class="muted">' + esc(scenario.startedAt || '') + '</span>') + '</td>'
        + '</tr>'
      );
    }
  }
  return rows.length
    ? '<table class="matrix"><thead><tr><th>Layer</th><th>Scenario</th><th>Status</th><th>Duration</th><th>Notes</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>'
    : '<div class="empty">No live layer state yet.</div>';
}

function renderEventRows(events) {
  if (!events || !events.length) {
    return '<div class="empty">No events recorded yet.</div>';
  }
  return '<div class="event-list">' + events.map((event) =>
    '<div class="event-row">'
      + '<div class="topline">'
      + '<div class="title">' + esc(event.kind) + '</div>'
      + '<div class="meta">#' + esc(event.seq) + ' · ' + esc(event.createdAt) + '</div>'
      + '</div>'
      + '<div class="detail">' + esc(JSON.stringify(event.payload, null, 2)) + '</div>'
    + '</div>'
  ).join('') + '</div>';
}

function renderProviderParity(rows) {
  if (!rows || !rows.length) {
    return '<div class="empty">No provider parity rows yet.</div>';
  }
  return '<div class="event-list">' + rows.map((row) =>
    '<div class="event-row">'
      + '<div class="topline">'
      + '<div class="title">' + esc(row.provider + '/' + row.model) + '</div>'
      + '<div class="meta"><span class="badge badge-info">' + esc(row.transport + (row.scope ? ' · ' + row.scope : '')) + '</span> <span class="badge ' + badgeClass(row.status) + '">' + esc(row.status) + '</span></div>'
      + '</div>'
      + (row.observedToolCall ? '<div class="detail">' + esc(row.observedToolCall) + '</div>' : '')
      + (row.failureReason ? '<div class="detail">' + esc(row.failureReason) + '</div>' : '')
    + '</div>'
  ).join('') + '</div>';
}

function resolveEvalRun(record) {
  if (!record || typeof record !== 'object') return {};
  return record.run && record.run.evalRun ? record.run.evalRun : record.evalRun || record.run || record;
}

function renderScenarioResults(results) {
  if (!results || !results.length) {
    return '<div class="empty">No scenario results recorded.</div>';
  }
  return '<div class="event-list">' + results.map((result) =>
    '<div class="event-row">'
      + '<div class="topline">'
      + '<div class="title">' + esc(result.scenarioId) + '</div>'
      + '<div class="meta"><span class="badge ' + badgeClass(result.status) + '">' + esc(result.status) + '</span></div>'
      + '</div>'
      + '<div class="detail">' + esc('checkpointCount=' + result.checkpointCount + (result.failureReason ? '\\n' + result.failureReason : '')) + '</div>'
    + '</div>'
  ).join('') + '</div>';
}

function renderRecommendations(recommendations) {
  if (!recommendations || !recommendations.length) {
    return '<div class="empty">No recommendations attached.</div>';
  }
  return '<div class="event-list">' + recommendations.map((recommendation) =>
    '<div class="event-row">'
      + '<div class="topline">'
      + '<div class="title">' + esc(recommendation.title) + '</div>'
      + '<div class="meta"><span class="badge ' + badgeClass(recommendation.status === 'applied' ? 'pass' : 'skip') + '">' + esc(recommendation.status) + '</span></div>'
      + '</div>'
      + (recommendation.summary ? '<div class="detail">' + esc(recommendation.summary) + '</div>' : '')
    + '</div>'
  ).join('') + '</div>';
}

function renderEvalRuns(evalRuns) {
  if (!evalRuns || !evalRuns.length) {
    return '<div class="empty">No scheduler eval payloads captured yet.</div>';
  }
  return evalRuns.map((record) => {
    const run = resolveEvalRun(record);
    return '<details open>'
      + '<summary>'
      + '<span>' + esc(run.evalDefinitionId || run.evalRunId || 'Scheduler Eval Run') + '</span>'
      + '<span class="badge badge-info">' + esc(run.summaryMode || 'checkpoints') + '</span>'
      + '</summary>'
      + '<div class="details-body">'
      + '<div class="kv">'
      + '<div class="key">evalRunId</div><div class="value">' + esc(run.evalRunId || 'n/a') + '</div>'
      + '<div class="key">rootTurnId</div><div class="value">' + esc(run.rootTurnId || 'n/a') + '</div>'
      + '<div class="key">finalSummaryText</div><div class="value">' + esc(run.finalSummaryText || 'n/a') + '</div>'
      + '</div>'
      + '<div class="split">'
      + '<div><h3>Scenario Results</h3>' + renderScenarioResults(run.scenarioResults || []) + '</div>'
      + '<div><h3>Recommendations</h3>' + renderRecommendations(run.recommendations || []) + '</div>'
      + '</div>'
      + '<div><h3>Checkpoints</h3>' + renderEventRows((run.checkpoints || []).map((checkpoint, index) => ({ seq: index + 1, kind: checkpoint.kind, createdAt: checkpoint.createdAt || 'n/a', payload: checkpoint }))) + '</div>'
      + '</div>'
      + '</details>';
  }).join('');
}

function renderComparisons(comparisons) {
  if (!comparisons || !comparisons.length) {
    return '<div class="empty">No comparisons attached.</div>';
  }
  return '<div class="event-list">' + comparisons.map((comparison) =>
    '<div class="event-row">'
      + '<div class="topline">'
      + '<div class="title">' + esc(comparison.label) + '</div>'
      + '<div class="meta"><span class="badge ' + badgeClass(comparison.status) + '">' + esc(comparison.status) + '</span></div>'
      + '</div>'
      + (comparison.summary ? '<div class="detail">' + esc(comparison.summary) + '</div>' : '')
    + '</div>'
  ).join('') + '</div>';
}`;
