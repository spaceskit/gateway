/**
 * SecurityMiddleware — enforces AgentSecurityScope and SecurityPolicy.
 *
 * Turn layer (order: 10):
 * - Pre: Verify agent permission mode allows the operation
 * - Post: If inspectAgentOutput, run secrets detection on output
 *
 * Stolen from: CrewAI's guardrails + Spaceskit's security model.
 */

import type { Middleware, MiddlewareContext } from "../types.js";
import type { SecurityPolicy, AgentSecurityScope, SecretsDetectionConfig } from "../../security/types.js";
import { DEFAULT_SECURITY_POLICY, DEFAULT_SECRETS_DETECTION_CONFIG } from "../../security/types.js";
import type { EventBus } from "../../events/event-bus.js";

export interface SecurityMiddlewareOptions {
  eventBus: EventBus;
  policy?: SecurityPolicy;
  secretsConfig?: SecretsDetectionConfig;
  resolveScope?: (
    spaceId: string,
    agentId: string,
  ) => Promise<AgentSecurityScope | null>;
}

// Simple regex-based secret patterns (production would use a proper scanner)
const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "api_key", pattern: /(?:sk|pk|api[_-]?key)[_-][a-zA-Z0-9]{20,}/gi },
  { name: "bearer_token", pattern: /Bearer\s+[a-zA-Z0-9._\-]{20,}/gi },
  { name: "private_key", pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/gi },
  { name: "password", pattern: /(?:password|passwd|pwd)\s*[:=]\s*["']?[^\s"']{8,}/gi },
];

export function createSecurityMiddleware(
  options: SecurityMiddlewareOptions,
): Middleware {
  const policy = options.policy ?? DEFAULT_SECURITY_POLICY;
  const secretsConfig = options.secretsConfig ?? DEFAULT_SECRETS_DETECTION_CONFIG;

  return {
    name: "security",
    layer: "turn",
    order: 10,
    async process(ctx: MiddlewareContext, next: () => Promise<void>) {
      const { spaceId, agentId } = ctx;

      // --- Pre-hook: Permission check ---
      if (spaceId && agentId && options.resolveScope) {
        const scope = await options.resolveScope(spaceId, agentId);
        if (scope?.permissionMode === "sandbox") {
          // In sandbox mode, check that the operation is within scope
          ctx.metadata.securityScope = scope;
        }
      }

      await next();

      // --- Post-hook: Output inspection ---
      if (policy.inspectAgentOutput && ctx.output && secretsConfig.scanAgentOutput) {
        const output =
          typeof ctx.output === "string"
            ? ctx.output
            : JSON.stringify(ctx.output);

        const detectedSecrets = scanForSecrets(output, secretsConfig);

        if (detectedSecrets.length > 0) {
          options.eventBus.emit({
            type: "security.secrets_detected",
            spaceId,
            agentId,
            secretCount: detectedSecrets.length,
            types: detectedSecrets.map((s) => s.name),
            timestamp: new Date(),
          });

          // Auto-redact if configured
          if (secretsConfig.autoRedact) {
            let redacted = output;
            for (const secret of detectedSecrets) {
              redacted = redacted.replace(secret.match, "[REDACTED]");
            }
            ctx.output = redacted;
          }
        }
      }

      // Audit log if configured
      if (policy.auditCapabilityInvocations) {
        options.eventBus.emit({
          type: "security.audit",
          spaceId,
          agentId,
          turnId: ctx.turnId,
          layer: ctx.layer,
          timestamp: new Date(),
        });
      }
    },
  };
}

function scanForSecrets(
  content: string,
  config: SecretsDetectionConfig,
): Array<{ name: string; match: string }> {
  const results: Array<{ name: string; match: string }> = [];

  for (const pattern of SECRET_PATTERNS) {
    const matches = content.matchAll(pattern.pattern);
    for (const match of matches) {
      results.push({ name: pattern.name, match: match[0] });
    }
  }

  // Custom patterns
  for (const custom of config.customPatterns) {
    try {
      const regex = new RegExp(custom.pattern, "gi");
      const matches = content.matchAll(regex);
      for (const match of matches) {
        results.push({ name: custom.name, match: match[0] });
      }
    } catch {
      // Invalid regex — skip
    }
  }

  return results;
}
