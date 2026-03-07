/**
 * SecretsMiddleware — comprehensive secrets detection and redaction
 * at the capability layer.
 *
 * Capability layer (order: 5):
 * - Pre: Scan capability arguments for secrets before they reach tools
 * - Post: Scan capability results for secrets before they reach the agent
 *
 * Detects:
 * - API keys (AWS, OpenAI, Anthropic, Stripe, GitHub, Slack, etc.)
 * - Bearer/JWT tokens
 * - Private keys (RSA, EC, Ed25519, PGP)
 * - Connection strings (PostgreSQL, MySQL, MongoDB, Redis)
 * - Passwords in config-like patterns
 * - High-entropy strings (potential secrets via Shannon entropy)
 * - SSH private keys
 *
 * Integrates with the existing security types from core/security/types.ts.
 */

import type { Middleware, MiddlewareContext } from "../types.js";
import type { EventBus } from "../../events/event-bus.js";
import type {
  SecretsDetectionConfig,
  DetectedSecret,
  SecretType,
} from "../../security/types.js";
import { DEFAULT_SECRETS_DETECTION_CONFIG } from "../../security/types.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface SecretsMiddlewareOptions {
  eventBus: EventBus;
  /** Override the default secrets detection config. */
  config?: Partial<SecretsDetectionConfig>;
  /** If true, block the capability call when secrets are detected (instead of just redacting). */
  blockOnDetection?: boolean;
}

// ---------------------------------------------------------------------------
// Built-in secret patterns — comprehensive set
// ---------------------------------------------------------------------------

interface SecretPattern {
  name: string;
  type: SecretType;
  /** Regex pattern to match. */
  pattern: RegExp;
  /** Confidence level for this pattern (0.0–1.0). */
  confidence: number;
}

const BUILT_IN_PATTERNS: SecretPattern[] = [
  // AWS
  { name: "aws_access_key", type: "api_key", pattern: /AKIA[0-9A-Z]{16}/g, confidence: 0.95 },
  { name: "aws_secret_key", type: "api_key", pattern: /(?:aws_secret_access_key|AWS_SECRET)\s*[:=]\s*["']?([A-Za-z0-9/+=]{40})["']?/gi, confidence: 0.9 },

  // OpenAI / Anthropic
  { name: "openai_api_key", type: "api_key", pattern: /sk-[a-zA-Z0-9]{20,}/g, confidence: 0.9 },
  { name: "anthropic_api_key", type: "api_key", pattern: /sk-ant-[a-zA-Z0-9_-]{20,}/g, confidence: 0.95 },

  // GitHub
  { name: "github_token", type: "token", pattern: /gh[ps]_[A-Za-z0-9_]{36,}/g, confidence: 0.95 },
  { name: "github_fine_grained", type: "token", pattern: /github_pat_[A-Za-z0-9_]{22,}/g, confidence: 0.95 },

  // Stripe
  { name: "stripe_key", type: "api_key", pattern: /(?:sk|pk|rk)_(?:test|live)_[A-Za-z0-9]{20,}/g, confidence: 0.95 },

  // Slack
  { name: "slack_token", type: "token", pattern: /xox[bpasr]-[0-9A-Za-z\-]{10,}/g, confidence: 0.9 },
  { name: "slack_webhook", type: "token", pattern: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[a-zA-Z0-9]+/g, confidence: 0.95 },

  // Generic API keys
  { name: "generic_api_key", type: "api_key", pattern: /(?:api[_-]?key|apikey|api_secret)\s*[:=]\s*["']?([a-zA-Z0-9_\-]{20,})["']?/gi, confidence: 0.7 },

  // Bearer tokens and JWTs
  { name: "bearer_token", type: "token", pattern: /Bearer\s+[a-zA-Z0-9._\-]{20,}/g, confidence: 0.85 },
  { name: "jwt_token", type: "token", pattern: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, confidence: 0.9 },

  // Private keys
  { name: "rsa_private_key", type: "private_key", pattern: /-----BEGIN (?:RSA )?PRIVATE KEY-----/g, confidence: 1.0 },
  { name: "ec_private_key", type: "private_key", pattern: /-----BEGIN EC PRIVATE KEY-----/g, confidence: 1.0 },
  { name: "openssh_private_key", type: "private_key", pattern: /-----BEGIN OPENSSH PRIVATE KEY-----/g, confidence: 1.0 },
  { name: "pgp_private_key", type: "private_key", pattern: /-----BEGIN PGP PRIVATE KEY BLOCK-----/g, confidence: 1.0 },

  // Connection strings
  { name: "postgres_connection", type: "connection_string", pattern: /postgres(?:ql)?:\/\/[^\s"']+:[^\s"']+@[^\s"']+/gi, confidence: 0.9 },
  { name: "mysql_connection", type: "connection_string", pattern: /mysql:\/\/[^\s"']+:[^\s"']+@[^\s"']+/gi, confidence: 0.9 },
  { name: "mongodb_connection", type: "connection_string", pattern: /mongodb(?:\+srv)?:\/\/[^\s"']+:[^\s"']+@[^\s"']+/gi, confidence: 0.9 },
  { name: "redis_connection", type: "connection_string", pattern: /redis:\/\/[^\s"']*:[^\s"']+@[^\s"']+/gi, confidence: 0.85 },

  // Passwords in config patterns
  { name: "password_field", type: "password", pattern: /(?:password|passwd|pwd|secret)\s*[:=]\s*["']([^"'\s]{8,})["']/gi, confidence: 0.75 },

  // Certificates (less common but still sensitive)
  { name: "certificate", type: "certificate", pattern: /-----BEGIN CERTIFICATE-----/g, confidence: 0.6 },
];

// ---------------------------------------------------------------------------
// Shannon entropy detection
// ---------------------------------------------------------------------------

/**
 * Calculate Shannon entropy of a string.
 * High entropy (> 4.5 for base64-like strings > 20 chars) may indicate a secret.
 */
function shannonEntropy(str: string): number {
  const freq = new Map<string, number>();
  for (const ch of str) {
    freq.set(ch, (freq.get(ch) ?? 0) + 1);
  }
  let entropy = 0;
  const len = str.length;
  for (const count of freq.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Detect high-entropy strings that could be secrets.
 * Only flags strings that look like base64/hex encoded values and
 * aren't common words or identifiers.
 */
function detectHighEntropyStrings(
  content: string,
  threshold: number,
): Array<{ offset: number; length: number; entropy: number }> {
  const results: Array<{ offset: number; length: number; entropy: number }> = [];

  // Look for long alphanumeric+special character sequences that might be secrets
  const candidates = content.matchAll(/[A-Za-z0-9+/=_\-]{20,}/g);

  for (const match of candidates) {
    const value = match[0];
    // Skip if it looks like a normal word (all lowercase, all uppercase short)
    if (/^[a-z]+$/.test(value) || (/^[A-Z]+$/.test(value) && value.length < 30)) {
      continue;
    }

    const entropy = shannonEntropy(value);
    if (entropy >= threshold) {
      results.push({
        offset: match.index ?? 0,
        length: value.length,
        entropy,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Core scanning function
// ---------------------------------------------------------------------------

function scanContent(
  content: string,
  config: SecretsDetectionConfig,
  source: string,
): DetectedSecret[] {
  const results: DetectedSecret[] = [];

  // Run built-in patterns
  for (const pattern of BUILT_IN_PATTERNS) {
    // Reset regex state
    pattern.pattern.lastIndex = 0;
    const matches = content.matchAll(pattern.pattern);

    for (const match of matches) {
      if (pattern.confidence >= config.confidenceThreshold) {
        results.push({
          type: pattern.type,
          source,
          offset: match.index ?? 0,
          length: match[0].length,
          confidence: pattern.confidence,
          redacted: false,
        });
      }
    }
  }

  // Run custom patterns from config
  for (const custom of config.customPatterns) {
    try {
      const regex = new RegExp(custom.pattern, "gi");
      const matches = content.matchAll(regex);
      for (const match of matches) {
        results.push({
          type: custom.type,
          source,
          offset: match.index ?? 0,
          length: match[0].length,
          confidence: 0.8,
          redacted: false,
        });
      }
    } catch {
      // Invalid regex — skip
    }
  }

  // Run entropy-based detection (threshold: 4.5 bits per character)
  const entropyHits = detectHighEntropyStrings(content, 4.5);
  for (const hit of entropyHits) {
    // Check if this offset is already covered by a pattern match
    const alreadyCovered = results.some(
      (r) => hit.offset >= r.offset && hit.offset < r.offset + r.length,
    );
    if (!alreadyCovered && hit.entropy >= 4.5) {
      results.push({
        type: "unknown",
        source,
        offset: hit.offset,
        length: hit.length,
        confidence: Math.min(0.5 + (hit.entropy - 4.5) * 0.2, 0.85),
        redacted: false,
      });
    }
  }

  return results;
}

/**
 * Redact all detected secrets in the content string.
 */
function redactSecrets(content: string, secrets: DetectedSecret[]): string {
  // Sort by offset descending so we can replace from end to start
  // without shifting indices
  const sorted = [...secrets].sort((a, b) => b.offset - a.offset);
  let result = content;

  for (const secret of sorted) {
    const before = result.slice(0, secret.offset);
    const after = result.slice(secret.offset + secret.length);
    result = before + "[REDACTED]" + after;
    secret.redacted = true;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

export function createSecretsMiddleware(
  options: SecretsMiddlewareOptions,
): Middleware {
  const config: SecretsDetectionConfig = {
    ...DEFAULT_SECRETS_DETECTION_CONFIG,
    ...options.config,
  };

  return {
    name: "secrets",
    layer: "capability",
    order: 5, // Runs before most other capability middleware
    async process(ctx: MiddlewareContext, next: () => Promise<void>) {
      // --- Pre-hook: Scan capability input/arguments ---
      if (config.scanAgentOutput && ctx.input != null) {
        const inputStr = typeof ctx.input === "string"
          ? ctx.input
          : JSON.stringify(ctx.input);

        const inputSecrets = scanContent(inputStr, config, "capability_args");

        if (inputSecrets.length > 0) {
          options.eventBus.emit({
            type: "security.secrets_detected",
            spaceId: ctx.spaceId,
            agentId: ctx.agentId,
            secretCount: inputSecrets.length,
            types: [...new Set(inputSecrets.map((s) => s.type))],
            source: "capability_args",
            timestamp: new Date(),
          });

          if (options.blockOnDetection) {
            ctx.terminate = true;
            ctx.output = {
              error: "SECRETS_DETECTED",
              message: `Blocked: ${inputSecrets.length} potential secret(s) detected in capability arguments`,
              detectedTypes: [...new Set(inputSecrets.map((s) => s.type))],
            };
            return;
          }

          // Auto-redact if configured
          if (config.autoRedact) {
            ctx.input = typeof ctx.input === "string"
              ? redactSecrets(inputStr, inputSecrets)
              : JSON.parse(redactSecrets(inputStr, inputSecrets));
          }
        }
      }

      await next();

      // --- Post-hook: Scan capability output/results ---
      if (config.scanToolResults && ctx.output != null) {
        const outputStr = typeof ctx.output === "string"
          ? ctx.output
          : JSON.stringify(ctx.output);

        const outputSecrets = scanContent(outputStr, config, "tool_result");

        if (outputSecrets.length > 0) {
          options.eventBus.emit({
            type: "security.secrets_detected",
            spaceId: ctx.spaceId,
            agentId: ctx.agentId,
            secretCount: outputSecrets.length,
            types: [...new Set(outputSecrets.map((s) => s.type))],
            source: "tool_result",
            timestamp: new Date(),
          });

          // Auto-redact if configured
          if (config.autoRedact) {
            ctx.output = typeof ctx.output === "string"
              ? redactSecrets(outputStr, outputSecrets)
              : JSON.parse(redactSecrets(outputStr, outputSecrets));
          }
        }
      }
    },
  };
}
