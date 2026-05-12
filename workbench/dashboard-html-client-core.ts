export function renderDashboardClientCore(runnerAvailable: boolean, analystAvailable: boolean, planningAvailable: boolean): string {
  return `const RUNNER_AVAILABLE = ${runnerAvailable ? "true" : "false"};
const ANALYST_AVAILABLE = ${analystAvailable ? "true" : "false"};
const PLANNING_AVAILABLE = ${planningAvailable ? "true" : "false"};
let activeTab = 'jobs';
let snapshot = { presets: [], queuedRuns: [], recentRuns: [] };
let analystSnapshot = { queuedSessions: [], recentSessions: [] };
let reports = [];
let planningAudit = null;
let selectedPlanningTask = null;
let selectedRunId = null;
let selectedRunDetail = null;
let selectedAnalystSessionId = null;
let selectedAnalystDetail = null;
let selectedReportFilename = null;
let selectedReport = null;
let jobsSocket = null;
let selectedRunRefreshTimer = null;
let reportsPollTimer = null;

function esc(value) {
  const node = document.createElement('div');
  node.textContent = value == null ? '' : String(value);
  return node.innerHTML;
}

function badgeClass(status) {
  if (status === 'pass' || status === 'completed' || status === 'running') return 'badge-pass';
  if (status === 'skip' || status === 'unavailable' || status === 'queued' || status === 'cancelling' || status === 'cancelled' || status === 'interrupted') return 'badge-skip';
  return 'badge-fail';
}

function formatDuration(value) {
  return typeof value === 'number' ? value + 'ms' : 'n/a';
}

function switchTab(tab) {
  activeTab = tab;
  document.getElementById('tab-jobs').classList.toggle('active', tab === 'jobs');
  const analystTab = document.getElementById('tab-analyst');
  if (analystTab) analystTab.classList.toggle('active', tab === 'analyst');
  document.getElementById('tab-planning').classList.toggle('active', tab === 'planning');
  document.getElementById('tab-reports').classList.toggle('active', tab === 'reports');
  document.getElementById('jobs-view').classList.toggle('hidden', tab !== 'jobs');
  const analystView = document.getElementById('analyst-view');
  if (analystView) analystView.classList.toggle('hidden', tab !== 'analyst');
  document.getElementById('planning-view').classList.toggle('hidden', tab !== 'planning');
  document.getElementById('reports-view').classList.toggle('hidden', tab !== 'reports');
}

function parseCsv(value) {
  return (value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

async function api(path, options) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options && options.headers ? options.headers : {}) },
    ...(options || {}),
  });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = body.error || JSON.stringify(body);
    } catch {}
    throw new Error(detail || ('HTTP ' + response.status));
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
}

async function fetchSnapshot() {
  if (!RUNNER_AVAILABLE) return;
  snapshot = await api('/api/jobs/snapshot', { method: 'GET' });
  renderJobs();
}

async function fetchRunDetail(runId) {
  if (!RUNNER_AVAILABLE || !runId) return;
  selectedRunDetail = await api('/api/jobs/runs/' + encodeURIComponent(runId), { method: 'GET' });
  selectedRunId = runId;
  renderRunDetail();
  renderJobs();
}

async function fetchReports() {
  reports = await api('/api/reports', { method: 'GET' });
  renderReports();
}

async function fetchAnalystSnapshot() {
  if (!ANALYST_AVAILABLE) return;
  analystSnapshot = await api('/api/analyst/snapshot', { method: 'GET' });
  renderAnalyst();
}

async function fetchAnalystDetail(sessionId) {
  if (!ANALYST_AVAILABLE || !sessionId) return;
  selectedAnalystDetail = await api('/api/analyst/sessions/' + encodeURIComponent(sessionId), { method: 'GET' });
  selectedAnalystSessionId = sessionId;
  renderAnalystDetail();
  renderAnalyst();
}

async function fetchReport(filename) {
  selectedReport = await api('/api/reports/' + encodeURIComponent(filename), { method: 'GET' });
  selectedReportFilename = filename;
  renderReportDetail();
  renderReports();
}

async function fetchPlanningAudit() {
  if (!PLANNING_AVAILABLE) return;
  planningAudit = await api('/api/planning/audit', { method: 'GET' });
  renderPlanning();
}

async function fetchPlanningTask(queueItemId) {
  if (!PLANNING_AVAILABLE || !queueItemId) return;
  selectedPlanningTask = await api('/api/planning/tasks/' + encodeURIComponent(queueItemId), { method: 'GET' });
  renderPlanningTaskDetail();
  renderPlanning();
}

function scheduleSelectedRunRefresh(runId) {
  if (!runId || runId !== selectedRunId) return;
  if (selectedRunRefreshTimer) clearTimeout(selectedRunRefreshTimer);
  selectedRunRefreshTimer = setTimeout(() => {
    selectedRunRefreshTimer = null;
    void fetchRunDetail(runId);
  }, 120);
}

function connectJobsWs() {
  if (!RUNNER_AVAILABLE) {
    document.getElementById('ws-status').textContent = 'ws unavailable';
    return;
  }
  const wsUrl = location.origin.replace(/^http/, 'ws') + '/api/jobs/ws';
  jobsSocket = new WebSocket(wsUrl);
  jobsSocket.addEventListener('open', () => {
    document.getElementById('ws-status').textContent = 'ws live';
  });
  jobsSocket.addEventListener('close', () => {
    document.getElementById('ws-status').textContent = 'ws reconnecting';
    setTimeout(connectJobsWs, 1000);
  });
  jobsSocket.addEventListener('error', () => {
    document.getElementById('ws-status').textContent = 'ws error';
  });
  jobsSocket.addEventListener('message', (message) => {
    const payload = JSON.parse(message.data);
    handleLiveMessage(payload);
  });
}

function handleLiveMessage(message) {
  if (message.type === 'snapshot') {
    snapshot = message.snapshot;
    renderJobs();
    return;
  }
  if (message.type === 'preset.created' || message.type === 'preset.updated' || message.type === 'preset.deleted') {
    void fetchSnapshot();
    return;
  }
  if (message.type === 'run.updated') {
    void fetchSnapshot();
    scheduleSelectedRunRefresh(message.run.id);
    return;
  }
  if (message.type === 'run.event') {
    scheduleSelectedRunRefresh(message.event.runId);
    return;
  }
  if (message.type === 'report.saved') {
    void fetchSnapshot();
    void fetchReports();
    scheduleSelectedRunRefresh(message.runId);
    return;
  }
  if (message.type === 'analyst.snapshot') {
    analystSnapshot = message.snapshot;
    renderAnalyst();
    return;
  }
  if (message.type === 'analyst.session.updated') {
    void fetchAnalystSnapshot();
    if (selectedAnalystSessionId === message.session.id) {
      void fetchAnalystDetail(message.session.id);
    }
    return;
  }
  if (message.type === 'analyst.session.event') {
    if (selectedAnalystSessionId === message.event.sessionId) {
      void fetchAnalystDetail(message.event.sessionId);
    }
    return;
  }
  if (message.type === 'analyst.proposal.saved') {
    void fetchAnalystSnapshot();
    if (selectedAnalystSessionId === message.sessionId) {
      void fetchAnalystDetail(message.sessionId);
    }
  }
}`;
}
