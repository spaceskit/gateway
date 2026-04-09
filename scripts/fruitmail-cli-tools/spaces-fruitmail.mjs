#!/usr/bin/env node

import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import process from "node:process";

const COMMON_FRUITMAIL_DIRS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
];

export function resolveFruitMailExecutable() {
  const envPath = process.env.PATH ?? "";
  const dirs = [...new Set([...envPath.split(delimiter), ...COMMON_FRUITMAIL_DIRS])];

  for (const dir of dirs) {
    const candidate = join(dir, "fruitmail");
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not found here, continue
    }
  }
  return undefined;
}

export function buildFruitMailCommandArgs(operation, payloadInput = {}) {
  const payload = typeof payloadInput === "object" && payloadInput !== null ? payloadInput : {};

  switch (operation) {
    case "stats":
      return ["stats"];

    case "recent": {
      const args = ["recent"];
      if (payload.days) args.push(String(payload.days));
      if (payload.limit) args.push("--limit", String(payload.limit));
      args.push("--json");
      return args;
    }

    case "search": {
      const args = ["search"];
      if (payload.subject) args.push("--subject", String(payload.subject));
      if (payload.sender) args.push("--sender", String(payload.sender));
      if (payload.to) args.push("--to", String(payload.to));
      if (payload.fromName) args.push("--from-name", String(payload.fromName));
      if (payload.unread) args.push("--unread");
      if (payload.read) args.push("--read");
      if (payload.days) args.push("--days", String(payload.days));
      if (payload.hasAttachment) args.push("--has-attachment");
      if (payload.attachmentType) args.push("--attachment-type", String(payload.attachmentType));
      if (payload.limit) args.push("--limit", String(payload.limit));
      args.push("--json");
      return args;
    }

    case "body": {
      const messageId = payload.messageId ?? payload.id;
      if (!messageId) throw new Error("messageId is required for body operation");
      return ["body", String(messageId), "--json"];
    }

    case "unread": {
      const args = ["unread"];
      if (payload.limit) args.push("--limit", String(payload.limit));
      args.push("--json");
      return args;
    }

    case "send": {
      // Send via /usr/bin/mail, not fruitmail
      return null; // Special case handled in runFruitMail
    }

    default:
      throw new Error(`Unknown fruitmail operation: ${operation}`);
  }
}

export async function runFruitMail(executable, operation, payload = {}, timeoutMs = 30_000) {
  // Special case: send email via /usr/bin/mail
  if (operation === "send") {
    return await sendEmail(payload);
  }

  const args = buildFruitMailCommandArgs(operation, payload);

  return new Promise((resolve, reject) => {
    const proc = spawn(executable, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
      timeout: timeoutMs,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => { stdout += chunk; });
    proc.stderr.on("data", (chunk) => { stderr += chunk; });

    proc.on("error", (err) => {
      reject(new Error(`fruitmail execution failed: ${err.message}`));
    });

    proc.on("close", (exitCode) => {
      if (exitCode !== 0) {
        reject(new Error(`fruitmail exited with code ${exitCode}: ${stderr.trim()}`));
        return;
      }

      // Parse stats output (not JSON)
      if (operation === "stats") {
        const stats = parseStatsOutput(stdout);
        resolve({ ok: true, operation: "stats", data: stats });
        return;
      }

      // Parse JSON output
      try {
        const data = JSON.parse(stdout);
        resolve({ ok: true, operation, data, summary: `${Array.isArray(data) ? data.length : 1} result(s)` });
      } catch {
        // Body might return plain text
        resolve({ ok: true, operation, data: stdout.trim() });
      }
    });

    proc.stdin.end();
  });
}

function parseStatsOutput(stdout) {
  const lines = stdout.split("\n");
  const stats = {};
  for (const line of lines) {
    const match = line.match(/^(\w[\w\s]*?):\s+(\d+)/);
    if (match) {
      const key = match[1].trim().toLowerCase().replace(/\s+/g, "_");
      stats[key] = parseInt(match[2], 10);
    }
  }
  return stats;
}

async function sendEmail(payload) {
  const { to, subject, body, cc } = payload;
  if (!to || !subject || !body) {
    throw new Error("to, subject, and body are required for send operation");
  }

  const args = ["-s", subject];
  if (cc) args.push("-c", cc);
  args.push(to);

  return new Promise((resolve, reject) => {
    const proc = spawn("/usr/bin/mail", args, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10_000,
    });

    let stderr = "";
    proc.stderr.on("data", (chunk) => { stderr += chunk; });

    proc.on("error", (err) => {
      reject(new Error(`mail send failed: ${err.message}`));
    });

    proc.on("close", (exitCode) => {
      if (exitCode !== 0) {
        reject(new Error(`mail exited with code ${exitCode}: ${stderr.trim()}`));
        return;
      }
      resolve({
        ok: true,
        operation: "send",
        summary: `Email sent to ${to}`,
        data: { to, subject, cc: cc || null },
      });
    });

    proc.stdin.write(body);
    proc.stdin.end();
  });
}

// CLI entrypoint — called by gateway shell tool executor
if (process.argv[1] && process.argv[1].endsWith("spaces-fruitmail.mjs")) {
  const operation = process.argv[2];
  const payloadRaw = process.argv[3];

  if (!operation) {
    console.error(JSON.stringify({ ok: false, error: "No operation specified" }));
    process.exit(1);
  }

  let payload = {};
  if (payloadRaw) {
    try {
      payload = JSON.parse(payloadRaw);
    } catch {
      console.error(JSON.stringify({ ok: false, error: "Invalid JSON payload" }));
      process.exit(1);
    }
  }

  const executable = resolveFruitMailExecutable();
  if (!executable && operation !== "send") {
    console.error(JSON.stringify({
      ok: false,
      error: "fruitmail not found. Install it with: npm install -g apple-mail-search-cli",
    }));
    process.exit(1);
  }

  runFruitMail(executable, operation, payload)
    .then((result) => {
      console.log(JSON.stringify(result));
    })
    .catch((err) => {
      console.error(JSON.stringify({
        ok: false,
        error: err.message,
        operation,
      }));
      process.exit(1);
    });
}
