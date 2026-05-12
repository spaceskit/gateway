export const DASHBOARD_STYLE = `  :root {
    --bg: #071018;
    --bg-2: #0d1826;
    --surface: rgba(14, 24, 38, 0.92);
    --surface-2: rgba(20, 32, 50, 0.96);
    --border: rgba(148, 163, 184, 0.18);
    --text: #e7f0fb;
    --muted: #92a6c4;
    --green: #3ddc97;
    --red: #ff6b6b;
    --yellow: #f7c948;
    --blue: #7cb7ff;
    --cyan: #61dafb;
    --mono: 'SFMono-Regular', 'SF Mono', 'Cascadia Code', monospace;
    --sans: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    color: var(--text);
    font-family: var(--sans);
    background:
      radial-gradient(circle at top left, rgba(124, 183, 255, 0.14), transparent 28%),
      radial-gradient(circle at top right, rgba(97, 218, 251, 0.10), transparent 30%),
      linear-gradient(180deg, var(--bg), var(--bg-2));
  }
  .page { max-width: 1520px; margin: 0 auto; padding: 28px 20px 48px; }
  header {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: end;
    gap: 16px;
    margin-bottom: 18px;
  }
  h1 { margin: 0; font-size: 28px; letter-spacing: -0.03em; }
  .subtitle { margin-top: 8px; color: var(--muted); font-size: 13px; font-family: var(--mono); }
  .topline { display: flex; flex-wrap: wrap; gap: 8px; }
  .tabs { display: flex; gap: 8px; margin: 18px 0; }
  .tab {
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 8px 14px;
    background: rgba(255,255,255,0.03);
    color: var(--muted);
    cursor: pointer;
    font-size: 12px;
    font-family: var(--mono);
  }
  .tab.active { color: var(--text); border-color: rgba(124, 183, 255, 0.45); background: rgba(124, 183, 255, 0.10); }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 6px 10px;
    font-size: 11px;
    color: var(--muted);
    background: rgba(255,255,255,0.03);
    font-family: var(--mono);
  }
  .panel {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 18px;
    box-shadow: 0 12px 36px rgba(0,0,0,0.22);
  }
  .panel-header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 16px 18px 0;
  }
  .panel-body { padding: 16px 18px 18px; }
  .grid-jobs {
    display: grid;
    grid-template-columns: 360px 360px minmax(0, 1fr);
    gap: 16px;
    align-items: start;
  }
  .grid-reports { display: grid; grid-template-columns: 420px minmax(0, 1fr); gap: 16px; align-items: start; }
  .stack { display: grid; gap: 16px; }
  .card {
    padding: 14px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface-2);
  }
  .card h3, .card h4 { margin: 0 0 10px; font-size: 14px; }
  .note { color: var(--muted); font-size: 12px; font-family: var(--mono); }
  .muted { color: var(--muted); }
  .list { display: grid; gap: 10px; }
  .row-card {
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 12px 14px;
    background: rgba(255,255,255,0.03);
  }
  .row-card.active { border-color: rgba(124, 183, 255, 0.48); box-shadow: inset 0 0 0 1px rgba(124, 183, 255, 0.22); }
  .row-top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .title { font-weight: 700; color: #f8fbff; }
  .meta { color: var(--muted); font-size: 12px; font-family: var(--mono); line-height: 1.45; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
  button, .button {
    appearance: none;
    border: 1px solid var(--border);
    background: rgba(255,255,255,0.04);
    color: var(--text);
    padding: 8px 10px;
    border-radius: 10px;
    cursor: pointer;
    font-size: 12px;
    font-family: var(--mono);
  }
  button:hover, .button:hover { border-color: rgba(124, 183, 255, 0.45); }
  button.primary { background: rgba(124, 183, 255, 0.14); border-color: rgba(124, 183, 255, 0.38); }
  button.danger { background: rgba(255, 107, 107, 0.12); border-color: rgba(255, 107, 107, 0.28); color: #ffdede; }
  button.ghost { background: transparent; }
  input, textarea {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: rgba(255,255,255,0.03);
    color: var(--text);
    padding: 10px 12px;
    font: inherit;
    font-size: 13px;
  }
  textarea { min-height: 64px; resize: vertical; }
  label { display: grid; gap: 6px; font-size: 12px; color: var(--muted); font-family: var(--mono); }
  form { display: grid; gap: 10px; }
  .summary-grid {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 12px;
    margin-bottom: 18px;
  }
  .summary-card {
    padding: 14px;
    border-radius: 14px;
    border: 1px solid var(--border);
    background: var(--surface-2);
  }
  .summary-card .label { color: var(--muted); font-size: 11px; font-family: var(--mono); text-transform: uppercase; letter-spacing: 0.08em; }
  .summary-card .value { margin-top: 8px; font-size: 20px; font-weight: 700; }
  .summary-card .hint { margin-top: 6px; color: var(--muted); font-size: 12px; line-height: 1.45; }
  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 3px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
    font-family: var(--mono);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    border: 1px solid transparent;
  }
  .badge-pass { background: rgba(61, 220, 151, 0.12); color: var(--green); border-color: rgba(61, 220, 151, 0.25); }
  .badge-fail { background: rgba(255, 107, 107, 0.12); color: var(--red); border-color: rgba(255, 107, 107, 0.25); }
  .badge-skip { background: rgba(247, 201, 72, 0.12); color: var(--yellow); border-color: rgba(247, 201, 72, 0.25); }
  .badge-info { background: rgba(124, 183, 255, 0.12); color: var(--blue); border-color: rgba(124, 183, 255, 0.25); }
  .badge-live { background: rgba(97, 218, 251, 0.12); color: var(--cyan); border-color: rgba(97, 218, 251, 0.25); }
  .matrix {
    width: 100%;
    border-collapse: collapse;
    overflow: hidden;
    border-radius: 14px;
    border: 1px solid var(--border);
  }
  .matrix th, .matrix td {
    padding: 10px 12px;
    border-bottom: 1px solid rgba(148, 163, 184, 0.12);
    text-align: left;
    vertical-align: top;
    font-size: 12px;
  }
  .matrix th {
    background: rgba(255,255,255,0.03);
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-family: var(--mono);
    font-size: 11px;
  }
  .matrix tr:last-child td { border-bottom: none; }
  .event-list { display: grid; gap: 8px; }
  .event-row {
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 12px 14px;
    background: rgba(255,255,255,0.03);
  }
  .event-row .topline {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
    justify-content: space-between;
  }
  .event-row .detail {
    margin-top: 8px;
    color: var(--muted);
    font-size: 12px;
    line-height: 1.5;
    font-family: var(--mono);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .split { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .empty {
    padding: 42px 12px;
    text-align: center;
    color: var(--muted);
    border: 1px dashed var(--border);
    border-radius: 14px;
    background: rgba(255,255,255,0.02);
  }
  .hidden { display: none !important; }
  .section { margin-top: 18px; }
  .section h3 { margin: 0 0 10px; font-size: 14px; }
  details {
    border: 1px solid var(--border);
    border-radius: 14px;
    background: rgba(255,255,255,0.03);
    overflow: hidden;
  }
  details > summary {
    list-style: none;
    cursor: pointer;
    padding: 12px 14px;
    display: flex;
    align-items: center;
    gap: 10px;
    justify-content: space-between;
    font-weight: 600;
  }
  details > summary::-webkit-details-marker { display: none; }
  .details-body {
    border-top: 1px solid rgba(148, 163, 184, 0.12);
    padding: 12px 14px 14px;
    display: grid;
    gap: 12px;
  }
  .kv {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 12px;
    font-size: 12px;
  }
  .kv .key { color: var(--muted); font-family: var(--mono); }
  .kv .value { color: #f8fbff; word-break: break-word; }
  @media (max-width: 1320px) {
    .grid-jobs { grid-template-columns: 1fr 1fr; }
    .grid-jobs > :last-child { grid-column: 1 / -1; }
    .grid-reports { grid-template-columns: 1fr; }
  }
  @media (max-width: 960px) {
    .grid-jobs, .split, .summary-grid { grid-template-columns: 1fr; }
  }`;
