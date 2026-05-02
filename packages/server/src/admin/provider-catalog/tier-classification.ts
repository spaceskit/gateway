/**
 * Tier classification for the gateway model catalog.
 *
 * Tiers map model identifiers to one of four intent-based labels used by the
 * client model picker (`fast`, `balanced`, `smartest`, `local`). The function
 * is pure — given a `(providerId, modelId, contextWindow?)` it returns a tier
 * deterministically, with no I/O or stateful lookups.
 *
 * Heuristic policy (in priority order):
 *  1. Apple, LM Studio, and Ollama always classify as `local` (on-device or
 *     local-runtime providers — see `LOCAL_PROVIDER_IDS` in
 *     provider-catalog-support.ts).
 *  2. CLI executors (`claude`, `codex`, `gemini`) are also treated as `local`
 *     when the gateway runs on the user's host. Their inner model id still
 *     gets re-classified by name keywords, but the *runtime* sits on the host.
 *     Per spec we surface them as `local`.
 *  3. Name keywords (case-insensitive) on the trimmed model identifier:
 *       - `haiku`, `mini`, `flash`, `nano`  → `fast`
 *       - `opus`, `pro`, `max`              → `smartest`
 *       (Note: `flash` wins for Gemini Flash; `pro` wins for Gemini Pro; we
 *       check `fast` keywords first so e.g. `gemini-3-flash-preview` is fast
 *       and `gemini-3-pro-preview` is smartest.)
 *  4. Anything else falls through to `balanced`.
 *
 * The optional `contextWindow` parameter does not currently move the
 * classification — every name-based match is accepted as-is. The parameter is
 * accepted (and tested) so a future heuristic can promote unusually large
 * context windows toward `smartest` without changing the call sites.
 */
export type ModelTier = "fast" | "balanced" | "smartest" | "local";

/**
 * Provider IDs whose runtime always sits on the user's machine. Mirrors
 * `LOCAL_PROVIDER_IDS` in `gateway/packages/bootstrap/src/services/provider-catalog-support.ts`.
 */
const LOCAL_PROVIDER_IDS: ReadonlySet<string> = new Set([
  "apple",
  "claude",
  "codex",
  "gemini",
  "lmstudio",
  "ollama",
]);

/**
 * On-device or local-runtime providers — always tier `local`, regardless of
 * the model id they expose. CLI executor providers (Claude Code / Codex CLI /
 * Gemini CLI) also fall here because the runtime is the user's local CLI.
 */
const LOCAL_RUNTIME_PROVIDER_IDS: ReadonlySet<string> = LOCAL_PROVIDER_IDS;

const FAST_KEYWORDS = ["haiku", "mini", "flash", "nano"] as const;
const SMARTEST_KEYWORDS = ["opus", "pro", "max"] as const;

/**
 * Strip provider prefixes such as `anthropic/` or `openrouter/openai/` so the
 * keyword match operates on the model name itself.
 */
function stripProviderPrefix(modelId: string): string {
  if (!modelId.includes("/")) {
    return modelId;
  }
  // For ids like `openrouter/openai/gpt-4.1-mini`, drop only the *first* segment.
  const slash = modelId.indexOf("/");
  return modelId.slice(slash + 1);
}

/**
 * Word-boundary keyword match. A naive `String.includes` would let `mini`
 * match inside `gemini`, mis-classifying Gemini-Pro models as `fast`. We
 * require the keyword to sit between non-letter delimiters (`-`, `.`, `/`,
 * digits, start, or end) so identifiers like `gpt-4.1-mini` and
 * `claude-haiku-4-5` match but `gemini-*` does not.
 */
function containsKeyword(haystack: string, keywords: ReadonlyArray<string>): boolean {
  for (const keyword of keywords) {
    const pattern = new RegExp(`(^|[^a-z])${keyword}([^a-z]|$)`);
    if (pattern.test(haystack)) {
      return true;
    }
  }
  return false;
}

/**
 * Classify a model into one of four tiers. Pure — no I/O, no caching.
 *
 * @param providerId  The provider id (e.g. `anthropic`, `openrouter`).
 * @param modelId     The model id (with or without a `provider/` prefix).
 * @param contextWindow Optional context window in tokens. Reserved for future
 *                    heuristic refinement; currently does not move the tier.
 */
export function classifyTier(
  providerId: string,
  modelId: string,
  // contextWindow is intentionally accepted (and tested) so future refinement
  // can use it without churning call sites; lint is suppressed for now.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  contextWindow?: number,
): ModelTier {
  const provider = providerId.trim().toLowerCase();
  const rawModel = (modelId ?? "").trim().toLowerCase();
  const bareModel = stripProviderPrefix(rawModel);

  if (LOCAL_RUNTIME_PROVIDER_IDS.has(provider)) {
    return "local";
  }

  if (containsKeyword(bareModel, FAST_KEYWORDS)) {
    return "fast";
  }
  if (containsKeyword(bareModel, SMARTEST_KEYWORDS)) {
    return "smartest";
  }

  return "balanced";
}
