export function renderDashboardBody(runnerAvailable: boolean, analystAvailable: boolean, planningAvailable: boolean): string {
  return `
</head>
<body>
  <div class="page">
    <header>
      <div>
        <h1>Workbench Live Runner</h1>
        <div class="subtitle">Jobs queue, analyst sessions, live progress, gateway traces, and saved reports.</div>
      </div>
      <div class="topline">
        <span class="pill">runner ${runnerAvailable ? "enabled" : "unavailable"}</span>
        <span class="pill">analyst ${analystAvailable ? "enabled" : "unavailable"}</span>
        <span class="pill">planning ${planningAvailable ? "enabled" : "unavailable"}</span>
        <span class="pill" id="ws-status">ws connecting</span>
      </div>
    </header>

    <div class="tabs">
      <button class="tab active" id="tab-jobs" type="button" onclick="switchTab('jobs')">Jobs</button>
      ${analystAvailable ? `<button class="tab" id="tab-analyst" type="button" onclick="switchTab('analyst')">Analyst</button>` : ""}
      <button class="tab" id="tab-planning" type="button" onclick="switchTab('planning')">Planning</button>
      <button class="tab" id="tab-reports" type="button" onclick="switchTab('reports')">Reports</button>
    </div>

    <section id="jobs-view">
      <div class="grid-jobs">
        <div class="stack">
          <section class="panel">
            <div class="panel-header">
              <span class="badge badge-live">presets</span>
              <span class="note">Saved logical run configs</span>
            </div>
            <div class="panel-body">
              <form id="preset-form" onsubmit="savePreset(event)">
                <input type="hidden" id="preset-id" />
                <label>Name<input id="preset-name" placeholder="Nightly parity" /></label>
                <label>Layers (comma separated)<input id="preset-layers" placeholder="chat-roundtrip,provider-tool-parity,orchestration" /></label>
                <label>Providers (optional, comma separated)<input id="preset-providers" placeholder="claude,codex" /></label>
                <div class="actions">
                  <button class="primary" type="submit">Save preset</button>
                  <button class="ghost" type="button" onclick="resetPresetForm()">Clear</button>
                </div>
              </form>
              <div class="section">
                <h3>Preset List</h3>
                <div id="preset-list" class="list"></div>
              </div>
            </div>
          </section>

          <section class="panel">
            <div class="panel-header">
              <span class="badge badge-live">ad hoc</span>
              <span class="note">Queue or run immediately without saving</span>
            </div>
            <div class="panel-body">
              <form id="adhoc-form">
                <label>Name<input id="adhoc-name" placeholder="Morning regression" /></label>
                <label>Layers (comma separated)<input id="adhoc-layers" placeholder="chat-roundtrip,provider-tool-parity" /></label>
                <label>Providers (optional, comma separated)<input id="adhoc-providers" placeholder="apple,claude" /></label>
                <div class="actions">
                  <button class="primary" type="button" onclick="submitAdHoc('run-now')">Run now</button>
                  <button type="button" onclick="submitAdHoc('queue')">Queue</button>
                </div>
              </form>
            </div>
          </section>
        </div>

        <div class="stack">
          <section class="panel">
            <div class="panel-header">
              <span class="badge badge-live">queue</span>
              <span class="note">One active worker, FIFO wait queue</span>
            </div>
            <div class="panel-body">
              <div id="queue-list" class="list"></div>
            </div>
          </section>
          <section class="panel">
            <div class="panel-header">
              <span class="badge badge-info">history</span>
              <span class="note">Recent completed, failed, and interrupted runs</span>
            </div>
            <div class="panel-body">
              <div id="recent-list" class="list"></div>
            </div>
          </section>
        </div>

        <section class="panel">
          <div class="panel-header">
            <span class="badge badge-info">run detail</span>
            <span class="note">Canonical runner state plus filtered gateway events</span>
          </div>
          <div class="panel-body" id="run-detail">
            <div class="empty">Select a run to inspect live progress, matrix status, logs, and gateway traces.</div>
          </div>
        </section>
      </div>
    </section>

    <section id="analyst-view" class="hidden">
      <div class="grid-jobs">
        <div class="stack">
          <section class="panel">
            <div class="panel-header">
              <span class="badge badge-live">from run</span>
              <span class="note">Start a manual analyst session from a completed or failed run</span>
            </div>
            <div class="panel-body">
              <form onsubmit="startAnalystFromRun(event)">
                <label>Run ID<input id="analyst-run-id" placeholder="run-..." /></label>
                <div class="actions">
                  <button class="primary" type="submit">Analyze run</button>
                </div>
              </form>
            </div>
          </section>

          <section class="panel">
            <div class="panel-header">
              <span class="badge badge-live">from space</span>
              <span class="note">Analyze an existing source space with an optional root turn anchor</span>
            </div>
            <div class="panel-body">
              <form onsubmit="startAnalystFromSpace(event)">
                <label>Space ID<input id="analyst-space-id" placeholder="space-..." /></label>
                <label>Root turn ID (optional)<input id="analyst-root-turn-id" placeholder="turn-..." /></label>
                <div class="actions">
                  <button class="primary" type="submit">Analyze space</button>
                </div>
              </form>
            </div>
          </section>
        </div>

        <div class="stack">
          <section class="panel">
            <div class="panel-header">
              <span class="badge badge-live">queue</span>
              <span class="note">Analyst sessions share the same local execution slot as jobs</span>
            </div>
            <div class="panel-body">
              <div id="analyst-queue-list" class="list"></div>
            </div>
          </section>
          <section class="panel">
            <div class="panel-header">
              <span class="badge badge-info">history</span>
              <span class="note">Recent analyst sessions and fix proposals</span>
            </div>
            <div class="panel-body">
              <div id="analyst-recent-list" class="list"></div>
            </div>
          </section>
        </div>

        <section class="panel">
          <div class="panel-header">
            <span class="badge badge-info">analyst detail</span>
            <span class="note">Proposal, evidence, verification commands, and events</span>
          </div>
          <div class="panel-body" id="analyst-detail">
            <div class="empty">Select an analyst session to inspect its evidence and fix proposal.</div>
          </div>
        </section>
      </div>
    </section>

    <section id="planning-view" class="hidden">
      <div class="grid-reports">
        <section class="panel">
          <div class="panel-header">
            <span class="badge badge-info">planning audit</span>
            <span class="note">Active queue goal-contract status</span>
          </div>
          <div class="panel-body">
            <div class="actions" style="margin-top:0;margin-bottom:12px">
              <button class="primary" type="button" onclick="fetchPlanningAudit()">Refresh audit</button>
            </div>
            <div id="planning-audit-list" class="list"></div>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <span class="badge badge-info">task source</span>
            <span class="note">Markdown backing the selected queue item</span>
          </div>
          <div class="panel-body" id="planning-task-detail">
            <div class="empty">Select a planning issue to inspect its task file.</div>
          </div>
        </section>
      </div>
    </section>

    <section id="reports-view" class="hidden">
      <div class="grid-reports">
        <section class="panel">
          <div class="panel-header">
            <span class="badge badge-info">reports</span>
            <span class="note">Saved JSON reports from completed runs</span>
          </div>
          <div class="panel-body">
            <div id="report-list" class="list"></div>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <span class="badge badge-info">report detail</span>
            <span class="note">Historical file-backed view</span>
          </div>
          <div class="panel-body" id="report-detail">
            <div class="empty">Select a saved report from the left.</div>
          </div>
        </section>
      </div>
    </section>
  </div>

`;
}
