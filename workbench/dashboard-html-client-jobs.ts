export const DASHBOARD_CLIENT_JOBS = `function renderJobs() {
  renderPresetList();
  renderQueueList();
  renderRecentList();
}

function presetCard(preset) {
  return '<div class="row-card">'
    + '<div class="row-top">'
    + '<div>'
    + '<div class="title">' + esc(preset.name) + '</div>'
    + '<div class="meta">' + esc(preset.layers.join(', ')) + (preset.providers.length ? '<br>' + esc(preset.providers.join(', ')) : '') + '</div>'
    + '</div>'
    + '<span class="badge badge-info">preset</span>'
    + '</div>'
    + '<div class="actions">'
    + '<button class="primary" type="button" onclick="runPresetNow(\\'' + preset.id + '\\')">Run now</button>'
    + '<button type="button" onclick="queuePreset(\\'' + preset.id + '\\')">Queue</button>'
    + '<button type="button" onclick="editPreset(\\'' + preset.id + '\\')">Edit</button>'
    + '<button class="danger" type="button" onclick="deletePreset(\\'' + preset.id + '\\')">Delete</button>'
    + '</div>'
    + '</div>';
}

function renderPresetList() {
  const element = document.getElementById('preset-list');
  if (!RUNNER_AVAILABLE) {
    element.innerHTML = '<div class="empty">Runner APIs are unavailable in this mode.</div>';
    return;
  }
  if (!snapshot.presets.length) {
    element.innerHTML = '<div class="empty">No presets saved yet.</div>';
    return;
  }
  element.innerHTML = snapshot.presets.map(presetCard).join('');
}

function runCard(run, kind) {
  const isSelected = selectedRunId === run.id;
  const actions = [];
  actions.push('<button type="button" onclick="openRun(\\'' + run.id + '\\')">Open</button>');
  if (run.status === 'queued' || run.status === 'starting' || run.status === 'running' || run.status === 'cancelling') {
    actions.push('<button class="danger" type="button" onclick="cancelRun(\\'' + run.id + '\\')">Cancel</button>');
  }
  if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled' || run.status === 'interrupted') {
    actions.push('<button type="button" onclick="retryRun(\\'' + run.id + '\\')">Retry</button>');
  }
  if (ANALYST_AVAILABLE && (run.status === 'completed' || run.status === 'failed')) {
    actions.push('<button type="button" onclick="prefillRunAnalysis(\\'' + run.id + '\\')">Analyze</button>');
  }
  if (run.reportFilename) {
    actions.push('<button type="button" onclick="openRunReport(\\'' + run.reportFilename + '\\')">Report</button>');
  }
  return '<div class="row-card' + (isSelected ? ' active' : '') + '">'
    + '<div class="row-top">'
    + '<div>'
    + '<div class="title">' + esc(run.name) + '</div>'
    + '<div class="meta">' + esc(run.id) + '<br>' + esc(run.config.layers.join(', ')) + (run.config.providers.length ? '<br>' + esc(run.config.providers.join(', ')) : '') + '</div>'
    + '</div>'
    + '<div>'
    + '<span class="badge ' + badgeClass(run.status) + '">' + esc(run.status) + '</span>'
    + (typeof run.queueRank === 'number' ? '<div class="meta">queue #' + run.queueRank + '</div>' : '')
    + '</div>'
    + '</div>'
    + '<div class="meta">' + esc(kind) + ' · ' + formatDuration(run.durationMs) + (run.exitSummary ? '<br>' + esc(run.exitSummary) : '') + '</div>'
    + '<div class="actions">' + actions.join('') + '</div>'
    + '</div>';
}

function renderQueueList() {
  const element = document.getElementById('queue-list');
  const rows = [];
  if (snapshot.activeRun) {
    rows.push(runCard(snapshot.activeRun, 'active'));
  }
  for (const run of snapshot.queuedRuns) {
    rows.push(runCard(run, 'queued'));
  }
  element.innerHTML = rows.length ? rows.join('') : '<div class="empty">No active or queued jobs.</div>';
}

function renderRecentList() {
  const element = document.getElementById('recent-list');
  element.innerHTML = snapshot.recentRuns.length
    ? snapshot.recentRuns.map((run) => runCard(run, 'recent')).join('')
    : '<div class="empty">No recent runs yet.</div>';
}

function analystSessionCard(session, kind) {
  const isSelected = selectedAnalystSessionId === session.id;
  const actions = ['<button type="button" onclick="openAnalystSession(\\'' + session.id + '\\')">Open</button>'];
  if (session.status === 'queued' || session.status === 'starting' || session.status === 'running' || session.status === 'cancelling') {
    actions.push('<button class="danger" type="button" onclick="cancelAnalystSession(\\'' + session.id + '\\')">Cancel</button>');
  }
  if (session.status === 'completed' || session.status === 'failed' || session.status === 'cancelled' || session.status === 'interrupted' || session.status === 'input_required') {
    actions.push('<button type="button" onclick="retryAnalystSession(\\'' + session.id + '\\')">Retry</button>');
  }
  const progressLabel = session.status === 'completed'
    ? 'Fix proposal created'
    : session.status === 'failed'
      ? 'Diagnosis failed'
      : session.status === 'interrupted'
        ? 'Diagnosis interrupted'
        : session.status === 'running'
          ? (session.phase === 'gathering_context'
            ? 'Gathering context'
            : session.phase === 'reproducing'
              ? 'Reproducing issue'
              : session.phase === 'analyzing'
                ? 'Analyzing evidence'
                : session.phase === 'drafting_fix'
                  ? 'Drafting fix proposal'
                  : 'Waiting for input')
          : session.status;
  return '<div class="row-card' + (isSelected ? ' active' : '') + '">'
    + '<div class="row-top">'
    + '<div>'
    + '<div class="title">' + esc(session.sourceType === 'run' ? ('Run ' + (session.sourceRunId || '')) : ('Space ' + session.sourceSpaceId)) + '</div>'
    + '<div class="meta">' + esc(session.id) + '<br>' + esc(progressLabel) + (session.analysisSpaceId ? '<br>analysis ' + esc(session.analysisSpaceId) : '') + '</div>'
    + '</div>'
    + '<div><span class="badge ' + badgeClass(session.status) + '">' + esc(session.status) + '</span>'
    + (typeof session.queueRank === 'number' ? '<div class="meta">queue #' + session.queueRank + '</div>' : '')
    + '</div>'
    + '</div>'
    + '<div class="meta">' + esc(kind) + ' · ' + formatDuration(session.durationMs) + (session.exitSummary ? '<br>' + esc(session.exitSummary) : '') + '</div>'
    + '<div class="actions">' + actions.join('') + '</div>'
    + '</div>';
}

function renderAnalystQueue() {
  const element = document.getElementById('analyst-queue-list');
  if (!ANALYST_AVAILABLE) {
    element.innerHTML = '<div class="empty">Analyst APIs are unavailable in this mode.</div>';
    return;
  }
  const rows = [];
  if (analystSnapshot.activeSession) {
    rows.push(analystSessionCard(analystSnapshot.activeSession, 'active'));
  }
  for (const session of analystSnapshot.queuedSessions) {
    rows.push(analystSessionCard(session, 'queued'));
  }
  element.innerHTML = rows.length ? rows.join('') : '<div class="empty">No queued analyst sessions.</div>';
}

function renderAnalystRecent() {
  const element = document.getElementById('analyst-recent-list');
  element.innerHTML = analystSnapshot.recentSessions.length
    ? analystSnapshot.recentSessions.map((session) => analystSessionCard(session, 'recent')).join('')
    : '<div class="empty">No recent analyst sessions yet.</div>';
}

function resetPresetForm() {
  document.getElementById('preset-id').value = '';
  document.getElementById('preset-name').value = '';
  document.getElementById('preset-layers').value = '';
  document.getElementById('preset-providers').value = '';
}

function editPreset(presetId) {
  const preset = snapshot.presets.find((entry) => entry.id === presetId);
  if (!preset) return;
  document.getElementById('preset-id').value = preset.id;
  document.getElementById('preset-name').value = preset.name;
  document.getElementById('preset-layers').value = preset.layers.join(',');
  document.getElementById('preset-providers').value = preset.providers.join(',');
}

async function savePreset(event) {
  event.preventDefault();
  const presetId = document.getElementById('preset-id').value;
  const payload = {
    name: document.getElementById('preset-name').value,
    layers: parseCsv(document.getElementById('preset-layers').value),
    providers: parseCsv(document.getElementById('preset-providers').value),
  };
  try {
    if (presetId) {
      await api('/api/jobs/presets/' + encodeURIComponent(presetId), {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
    } else {
      await api('/api/jobs/presets', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    }
    resetPresetForm();
    await fetchSnapshot();
  } catch (error) {
    alert(error.message);
  }
}

async function deletePreset(presetId) {
  if (!confirm('Delete this preset?')) return;
  try {
    await api('/api/jobs/presets/' + encodeURIComponent(presetId), { method: 'DELETE' });
    if (document.getElementById('preset-id').value === presetId) {
      resetPresetForm();
    }
    await fetchSnapshot();
  } catch (error) {
    alert(error.message);
  }
}

function collectAdHocPayload() {
  return {
    name: document.getElementById('adhoc-name').value || undefined,
    layers: parseCsv(document.getElementById('adhoc-layers').value),
    providers: parseCsv(document.getElementById('adhoc-providers').value),
  };
}

async function submitAdHoc(mode) {
  try {
    const run = await api(mode === 'run-now' ? '/api/jobs/run-now' : '/api/jobs/queue', {
      method: 'POST',
      body: JSON.stringify(collectAdHocPayload()),
    });
    if (run && run.id) {
      await fetchSnapshot();
      await fetchRunDetail(run.id);
    }
  } catch (error) {
    alert(error.message);
  }
}

async function queuePreset(presetId) {
  try {
    const run = await api('/api/jobs/presets/' + encodeURIComponent(presetId) + '/queue', { method: 'POST' });
    await fetchSnapshot();
    if (run && run.id) await fetchRunDetail(run.id);
  } catch (error) {
    alert(error.message);
  }
}

async function runPresetNow(presetId) {
  try {
    const run = await api('/api/jobs/presets/' + encodeURIComponent(presetId) + '/run-now', { method: 'POST' });
    await fetchSnapshot();
    if (run && run.id) await fetchRunDetail(run.id);
  } catch (error) {
    alert(error.message);
  }
}

async function cancelRun(runId) {
  try {
    await api('/api/jobs/runs/' + encodeURIComponent(runId) + '/cancel', { method: 'POST' });
    await fetchSnapshot();
    await fetchRunDetail(runId);
  } catch (error) {
    alert(error.message);
  }
}

async function retryRun(runId) {
  try {
    const run = await api('/api/jobs/runs/' + encodeURIComponent(runId) + '/retry', { method: 'POST' });
    await fetchSnapshot();
    if (run && run.id) await fetchRunDetail(run.id);
  } catch (error) {
    alert(error.message);
  }
}

function openRun(runId) {
  void fetchRunDetail(runId);
}

function openRunReport(filename) {
  switchTab('reports');
  void fetchReport(filename);
}

function prefillRunAnalysis(runId) {
  if (!ANALYST_AVAILABLE) return;
  switchTab('analyst');
  document.getElementById('analyst-run-id').value = runId;
}

async function startAnalystFromRun(event) {
  event.preventDefault();
  try {
    const runId = document.getElementById('analyst-run-id').value.trim();
    if (!runId) return;
    const session = await api('/api/analyst/sessions/from-run', {
      method: 'POST',
      body: JSON.stringify({ runId }),
    });
    await fetchAnalystDetail(session.id);
  } catch (error) {
    alert(error.message);
  }
}

async function startAnalystFromSpace(event) {
  event.preventDefault();
  try {
    const spaceId = document.getElementById('analyst-space-id').value.trim();
    const rootTurnId = document.getElementById('analyst-root-turn-id').value.trim();
    if (!spaceId) return;
    const session = await api('/api/analyst/sessions/from-space', {
      method: 'POST',
      body: JSON.stringify({ spaceId, ...(rootTurnId ? { rootTurnId } : {}) }),
    });
    await fetchAnalystDetail(session.id);
  } catch (error) {
    alert(error.message);
  }
}

function openAnalystSession(sessionId) {
  switchTab('analyst');
  void fetchAnalystDetail(sessionId);
}

async function retryAnalystSession(sessionId) {
  try {
    const session = await api('/api/analyst/sessions/' + encodeURIComponent(sessionId) + '/retry', { method: 'POST' });
    await fetchAnalystDetail(session.id);
  } catch (error) {
    alert(error.message);
  }
}

async function cancelAnalystSession(sessionId) {
  try {
    await api('/api/analyst/sessions/' + encodeURIComponent(sessionId) + '/cancel', { method: 'POST' });
    if (selectedAnalystSessionId === sessionId) {
      await fetchAnalystDetail(sessionId);
    }
  } catch (error) {
    alert(error.message);
  }
}`;
