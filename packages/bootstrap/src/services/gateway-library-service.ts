import { randomUUID } from "node:crypto";
import type {
  GatewayLinkedSkillIndexRepository,
  GatewaySkillCatalogRepository,
  GatewaySkillDraftRepository,
} from "@spaceskit/persistence";
import type {
  LibraryArchiveEntryPayload,
  LibraryArchiveEntryResponsePayload,
  LibraryCreateSkillDraftPayload,
  LibraryCreateSkillDraftResponsePayload,
  LibraryDeleteEntryPayload,
  LibraryDeleteEntryResponsePayload,
  LibraryDeleteSkillDraftPayload,
  LibraryDeleteSkillDraftResponsePayload,
  LibraryGetEntryResponsePayload,
  LibraryGetSkillDraftResponsePayload,
  LibraryImportEntryPayload,
  LibraryImportEntryResponsePayload,
  LibraryListEntriesPayload,
  LibraryListEntriesResponsePayload,
  LibraryListSkillDraftsResponsePayload,
  LibrarySaveSkillPayload,
  LibrarySaveSkillResponsePayload,
  LibraryScanEntriesResponsePayload,
  LibrarySetEntryEnabledPayload,
  LibrarySetEntryEnabledResponsePayload,
} from "./internal-payload-types.js";
import { GatewayLinkedSkillIndexService } from "./gateway-library-linked-index.js";
import {
  attachImportedState,
  buildImportedBySource,
  buildSkillDraftMarkdown,
  buildVerifiedEntries,
  compareLibraryEntries,
  inferDraftName,
  matchesRequestedStatus,
  matchesRequestedTags,
  normalizeEntryStatusPayload,
  normalizeInstalledEnabledFilter,
  normalizeInstalledStatusFilter,
  normalizeLimit,
  normalizeOptional,
  normalizePersistedSkillState,
  normalizeRequired,
  normalizeSourceKinds,
  normalizeStatusFilter,
  normalizeStringArray,
  parseJsonRecord,
  searchEntry,
  slugify,
  toInstalledEntry,
  toSkillDraftPayload,
} from "./gateway-library-read-model.js";

export interface GatewayLibraryServiceOptions {
  repository: GatewaySkillCatalogRepository;
  linkedRepository?: GatewayLinkedSkillIndexRepository | null;
  drafts?: GatewaySkillDraftRepository | null;
  workspaceRoot?: string;
  scanRoots?: string[];
}

export class GatewayLibraryService {
  private readonly repository: GatewaySkillCatalogRepository;
  private readonly linkedIndex: GatewayLinkedSkillIndexService;
  private readonly drafts: GatewaySkillDraftRepository | null;

  constructor(options: GatewayLibraryServiceOptions) {
    this.repository = options.repository;
    this.linkedIndex = new GatewayLinkedSkillIndexService({
      repository: options.linkedRepository,
      workspaceRoot: options.workspaceRoot,
      scanRoots: options.scanRoots,
    });
    this.drafts = options.drafts ?? null;
  }

  listEntries(input: LibraryListEntriesPayload = {}): LibraryListEntriesResponsePayload["entries"] {
    this.linkedIndex.ensureReady();
    const query = normalizeOptional(input.query);
    const requestedTags = normalizeStringArray(input.tags);
    const requestedStatus = normalizeStatusFilter(input.status);
    const requestedSourceKinds = normalizeSourceKinds(input.sourceKinds);
    const includeArchived = input.includeArchived === true || requestedStatus === "archived" || requestedStatus === "all";
    const includeContent = input.includeContent === true;
    const installedRows = this.repository.list({
      query,
      tags: requestedTags,
      sourceKinds: requestedSourceKinds.filter((kind) => kind === "installed" || kind === "system") as Array<"installed" | "system">,
      enabled: normalizeInstalledEnabledFilter(requestedStatus),
      status: normalizeInstalledStatusFilter(requestedStatus, includeArchived),
      limit: input.limit,
    });
    const installedEntries = installedRows.map((row) => toInstalledEntry(row, includeContent));
    const linkedEntries = this.linkedIndex.listEntries(includeContent);
    const verifiedEntries = buildVerifiedEntries(includeContent);
    const importedBySource = buildImportedBySource(installedRows);

    const entries = [
      ...installedEntries,
      ...linkedEntries.map((entry) => attachImportedState(entry, importedBySource)),
      ...verifiedEntries.map((entry) => attachImportedState(entry, importedBySource)),
    ].filter((entry) => {
      if (requestedSourceKinds.length > 0 && !requestedSourceKinds.includes(entry.sourceKind)) {
        return false;
      }
      if (!matchesRequestedStatus(entry, requestedStatus, includeArchived)) {
        return false;
      }
      if (!matchesRequestedTags(entry, requestedTags)) {
        return false;
      }
      if (!query) {
        return true;
      }
      return searchEntry(entry, query);
    });

    return entries
      .sort(compareLibraryEntries)
      .slice(0, normalizeLimit(input.limit) ?? entries.length);
  }

  getEntry(entryId: string, includeContent = false): LibraryGetEntryResponsePayload["entry"] | null {
    this.linkedIndex.ensureReady();
    const normalizedEntryId = normalizeRequired(entryId, "entryId");
    if (normalizedEntryId.startsWith("linked:")) {
      return this.linkedIndex.getEntry(normalizedEntryId, includeContent);
    }
    if (normalizedEntryId.startsWith("verified:")) {
      return buildVerifiedEntries(includeContent).find((entry) => entry.entryId === normalizedEntryId) ?? null;
    }

    const row = this.repository.get(normalizedEntryId);
    if (!row) return null;
    return toInstalledEntry(row, includeContent);
  }

  saveSkill(input: LibrarySaveSkillPayload): LibrarySaveSkillResponsePayload {
    const entryId = normalizeOptional(input.entryId) ?? normalizeOptional(input.skillId) ?? `skill-${randomUUID()}`;
    const existing = this.repository.get(entryId);
    const requestedStatus = normalizeEntryStatusPayload(input.status);
    const persistedState = normalizePersistedSkillState(requestedStatus, input.enabled);
    const row = this.repository.upsert({
      skillId: entryId,
      name: normalizeRequired(input.name, "name"),
      description: normalizeOptional(input.description),
      contentMarkdown: normalizeRequired(input.contentMarkdown, "contentMarkdown"),
      sourceRef: normalizeOptional(input.sourceRef),
      sourceKind: input.sourceKind === "system" ? "system" : "installed",
      enabled: persistedState.enabled,
      tags: normalizeStringArray(input.tags),
      provenance: existing ? parseJsonRecord(existing.provenance_json) : {},
      status: persistedState.status,
    });

    return {
      entry: toInstalledEntry(row, true),
      created: !existing,
    };
  }

  importEntry(input: LibraryImportEntryPayload): LibraryImportEntryResponsePayload {
    const sourceEntry = this.getEntry(input.entryId, true);
    if (!sourceEntry) {
      throw { code: "NOT_FOUND", message: `Library entry not found: ${input.entryId}` };
    }
    if (!sourceEntry.importable) {
      throw { code: "FAILED_PRECONDITION", message: `Entry is not importable: ${input.entryId}` };
    }

    const skillId = normalizeOptional(input.skillId)
      ?? slugify(normalizeOptional(input.name) ?? sourceEntry.name)
      ?? `skill-${randomUUID()}`;
    const existing = this.repository.get(skillId);
    const row = this.repository.upsert({
      skillId,
      name: normalizeOptional(input.name) ?? sourceEntry.name,
      description: sourceEntry.description,
      contentMarkdown: sourceEntry.contentMarkdown ?? "",
      sourceRef: sourceEntry.sourceRef,
      sourceKind: "installed",
      enabled: true,
      tags: sourceEntry.tags,
      provenance: {
        importedFrom: sourceEntry.entryId,
        importedSourceKind: sourceEntry.sourceKind,
      },
      status: "active",
    });

    return {
      entry: toInstalledEntry(row, true),
      created: !existing,
    };
  }

  archiveEntry(input: LibraryArchiveEntryPayload): LibraryArchiveEntryResponsePayload {
    const row = this.repository.archive(normalizeRequired(input.entryId, "entryId"));
    if (!row) {
      throw { code: "NOT_FOUND", message: `Library entry not found: ${input.entryId}` };
    }
    return {
      entry: toInstalledEntry(row, true),
      archived: row.status === "archived",
    };
  }

  setEntryEnabled(input: LibrarySetEntryEnabledPayload): LibrarySetEntryEnabledResponsePayload {
    const row = this.repository.setEnabled(
      normalizeRequired(input.entryId, "entryId"),
      input.enabled === true,
    );
    if (!row) {
      throw { code: "NOT_FOUND", message: `Library entry not found: ${input.entryId}` };
    }
    return {
      entry: toInstalledEntry(row, true),
    };
  }

  deleteEntry(input: LibraryDeleteEntryPayload): LibraryDeleteEntryResponsePayload {
    return {
      entryId: normalizeRequired(input.entryId, "entryId"),
      deleted: this.repository.delete(normalizeRequired(input.entryId, "entryId")),
    };
  }

  scanEntries(): LibraryScanEntriesResponsePayload {
    const linkedEntries = this.linkedIndex.scanEntries();
    return {
      entries: [
        ...linkedEntries,
        ...buildVerifiedEntries(false),
      ],
      scannedAt: new Date().toISOString(),
    };
  }

  listSkillDrafts(): LibraryListSkillDraftsResponsePayload["drafts"] {
    if (!this.drafts) return [];
    return this.drafts.list().map(toSkillDraftPayload);
  }

  getSkillDraft(draftId: string): LibraryGetSkillDraftResponsePayload["draft"] | null {
    if (!this.drafts) return null;
    const draft = this.drafts.get(normalizeRequired(draftId, "draftId"));
    if (!draft) return null;
    return toSkillDraftPayload(draft);
  }

  createSkillDraft(input: LibraryCreateSkillDraftPayload): LibraryCreateSkillDraftResponsePayload {
    if (!this.drafts) {
      throw { code: "FAILED_PRECONDITION", message: "Skill draft repository unavailable" };
    }

    const draftId = normalizeOptional(input.draftId) ?? `draft-${randomUUID()}`;
    const existing = this.drafts.get(draftId);
    const name = normalizeOptional(input.name) ?? inferDraftName(input.requestPrompt);
    const description = normalizeOptional(input.description) ?? input.requestPrompt.trim();
    const draft = this.drafts.upsert({
      draftId,
      name,
      description,
      requestPrompt: normalizeRequired(input.requestPrompt, "requestPrompt"),
      contentMarkdown: buildSkillDraftMarkdown({
        name,
        description,
        requestPrompt: input.requestPrompt,
      }),
    });

    return {
      draft: toSkillDraftPayload(draft),
      created: !existing,
    };
  }

  deleteSkillDraft(input: LibraryDeleteSkillDraftPayload): LibraryDeleteSkillDraftResponsePayload {
    if (!this.drafts) {
      return {
        draftId: normalizeRequired(input.draftId, "draftId"),
        deleted: false,
      };
    }
    return {
      draftId: normalizeRequired(input.draftId, "draftId"),
      deleted: this.drafts.delete(normalizeRequired(input.draftId, "draftId")),
    };
  }

  getActiveSkillMarkdownMap(skillIds: string[]): Map<string, string> {
    this.linkedIndex.ensureReady();
    const markdownById = new Map<string, string>();
    for (const skillId of normalizeStringArray(skillIds)) {
      const linkedMarkdown = this.linkedIndex.getActiveSkillMarkdown(skillId);
      if (linkedMarkdown.found) {
        if (linkedMarkdown.markdown) {
          markdownById.set(skillId, linkedMarkdown.markdown);
        }
        continue;
      }

      const row = this.repository.get(skillId);
      if (!row || row.status !== "active" || row.enabled !== 1) continue;
      const content = row.content_markdown.trim();
      if (!content) continue;
      markdownById.set(skillId, content);
    }
    return markdownById;
  }
}
