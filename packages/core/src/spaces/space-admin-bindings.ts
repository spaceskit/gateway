import { randomUUID } from "node:crypto";
import { SpaceAdminError } from "./space-admin-errors.js";
import type { SpaceAdminIdempotency } from "./space-admin-idempotency.js";
import { parseSpaceResourceType, uniqueStrings } from "./space-admin-normalizers.js";
import type { SpaceAdminSupport } from "./space-admin-support.js";
import type {
  AddSpaceResourceInput,
  AddSpaceSkillInput,
  RemoveSpaceResourceInput,
  RemoveSpaceSkillInput,
  SpaceAdminServiceOptions,
} from "./space-admin-service.js";
import type { SpaceResource, SpaceResourceType } from "./types.js";

export class SpaceAdminBindings {
  private readonly reservedSpaceResourceIdPrefixes: string[];
  private readonly isProtectedSpaceSkill?: SpaceAdminServiceOptions["isProtectedSpaceSkill"];
  private readonly isProtectedSpaceResource?: SpaceAdminServiceOptions["isProtectedSpaceResource"];

  constructor(
    private readonly options: SpaceAdminServiceOptions,
    private readonly now: () => Date,
    private readonly idempotency: SpaceAdminIdempotency,
    private readonly support: SpaceAdminSupport,
  ) {
    this.reservedSpaceResourceIdPrefixes = uniqueStrings(
      (options.reservedSpaceResourceIdPrefixes ?? [])
        .map((prefix) => prefix.trim())
        .filter((prefix) => prefix.length > 0),
    );
    this.isProtectedSpaceSkill = options.isProtectedSpaceSkill;
    this.isProtectedSpaceResource = options.isProtectedSpaceResource;
  }

  async addSkillToSpace(input: AddSpaceSkillInput): Promise<string[]> {
    const spaceId = input.spaceId.trim();
    const skillId = input.skillId.trim();
    this.validateSpaceSkillInput(spaceId, skillId);

    return this.idempotency.run(
      "space.add_skill",
      input.idempotencyKey,
      {
        spaceId,
        skillId,
      },
      async () => {
        const space = await this.options.getSpaceRow(spaceId);
        if (!space) {
          throw new SpaceAdminError("NOT_FOUND", `Space not found: ${spaceId}`);
        }

        await this.options.upsertSpaceSkillRow({
          spaceId,
          skillId,
          addedAt: this.now().toISOString(),
        });
        return this.listSpaceSkills(spaceId);
      },
    );
  }

  async removeSkillFromSpace(input: RemoveSpaceSkillInput): Promise<{ removed: boolean; skills: string[] }> {
    const spaceId = input.spaceId.trim();
    const skillId = input.skillId.trim();
    this.validateSpaceSkillInput(spaceId, skillId);

    return this.idempotency.run(
      "space.remove_skill",
      input.idempotencyKey,
      {
        spaceId,
        skillId,
      },
      async () => {
        const space = await this.options.getSpaceRow(spaceId);
        if (!space) {
          throw new SpaceAdminError("NOT_FOUND", `Space not found: ${spaceId}`);
        }

        if (this.isProtectedSpaceSkill) {
          const protectedSkill = await this.isProtectedSpaceSkill(spaceId, skillId);
          if (protectedSkill) {
            throw new SpaceAdminError(
              "FAILED_PRECONDITION",
              `Skill cannot be removed from protected space binding: ${skillId}`,
            );
          }
        }
        const removed = await this.options.deleteSpaceSkillRow(spaceId, skillId);
        const skills = await this.listSpaceSkills(spaceId);
        return { removed, skills };
      },
    );
  }

  async listSpaceSkills(spaceIdRaw: string): Promise<string[]> {
    const spaceId = spaceIdRaw.trim();
    if (!spaceId) {
      throw new SpaceAdminError("INVALID_ARGUMENT", "spaceId is required");
    }

    const row = await this.options.getSpaceRow(spaceId);
    if (!row) {
      throw new SpaceAdminError("NOT_FOUND", `Space not found: ${spaceId}`);
    }

    const stored = await this.options.listSpaceSkillRows(spaceId);
    return uniqueStrings(stored.map((entry) => entry.skillId));
  }

  async addResource(input: AddSpaceResourceInput): Promise<SpaceResource> {
    const spaceId = input.spaceId.trim();
    const requestedResourceId = input.resourceId?.trim();
    const uri = input.uri.trim();
    const type = parseSpaceResourceType(input.type);
    const label = input.label?.trim();
    if (!type) {
      throw new SpaceAdminError("INVALID_ARGUMENT", `Invalid resource type: ${String(input.type)}`);
    }
    if (requestedResourceId && this.isReservedSpaceResourceId(requestedResourceId)) {
      throw new SpaceAdminError(
        "INVALID_ARGUMENT",
        `resourceId uses a reserved prefix and cannot be assigned directly: ${requestedResourceId}`,
      );
    }
    this.validateSpaceResourceInput(spaceId, uri, type);

    return this.idempotency.run(
      "space.add_resource",
      input.idempotencyKey,
      {
        spaceId,
        resourceId: requestedResourceId ?? null,
        uri,
        type,
        label: label ?? null,
      },
      async () => {
        const space = await this.options.getSpaceRow(spaceId);
        if (!space) {
          throw new SpaceAdminError("NOT_FOUND", `Space not found: ${spaceId}`);
        }

        const row = await this.options.upsertSpaceResourceRow({
          resourceId: requestedResourceId || `space-resource-${randomUUID()}`,
          spaceId,
          uri,
          type,
          label,
          addedAt: this.now().toISOString(),
        });
        return this.support.rowToSpaceResource(row);
      },
    );
  }

  async removeResource(input: RemoveSpaceResourceInput): Promise<boolean> {
    const spaceId = input.spaceId.trim();
    const resourceId = input.resourceId.trim();
    if (!spaceId || !resourceId) {
      throw new SpaceAdminError("INVALID_ARGUMENT", "spaceId and resourceId are required");
    }

    return this.idempotency.run(
      "space.remove_resource",
      input.idempotencyKey,
      {
        spaceId,
        resourceId,
      },
      async () => {
        const space = await this.options.getSpaceRow(spaceId);
        if (!space) {
          throw new SpaceAdminError("NOT_FOUND", `Space not found: ${spaceId}`);
        }
        if (this.isProtectedSpaceResource) {
          const protectedResource = await this.isProtectedSpaceResource(spaceId, resourceId);
          if (protectedResource) {
            throw new SpaceAdminError(
              "FAILED_PRECONDITION",
              `Resource cannot be removed directly while managed: ${resourceId}`,
            );
          }
        }
        return this.options.deleteSpaceResourceRow(spaceId, resourceId);
      },
    );
  }

  async listResources(spaceIdRaw: string): Promise<SpaceResource[]> {
    const spaceId = spaceIdRaw.trim();
    if (!spaceId) {
      throw new SpaceAdminError("INVALID_ARGUMENT", "spaceId is required");
    }

    const row = await this.options.getSpaceRow(spaceId);
    if (!row) {
      throw new SpaceAdminError("NOT_FOUND", `Space not found: ${spaceId}`);
    }

    const resources = await this.options.listSpaceResourceRows(spaceId);
    return resources.map((entry) => this.support.rowToSpaceResource(entry));
  }

  private isReservedSpaceResourceId(resourceId: string): boolean {
    if (this.reservedSpaceResourceIdPrefixes.length === 0) return false;
    return this.reservedSpaceResourceIdPrefixes.some((prefix) => resourceId.startsWith(prefix));
  }

  private validateSpaceSkillInput(spaceId: string, skillId: string): void {
    if (!spaceId.trim()) {
      throw new SpaceAdminError("INVALID_ARGUMENT", "spaceId is required");
    }
    if (!skillId.trim()) {
      throw new SpaceAdminError("INVALID_ARGUMENT", "skillId is required");
    }
  }

  private validateSpaceResourceInput(
    spaceId: string,
    uri: string,
    type: SpaceResourceType,
  ): void {
    if (!spaceId.trim()) {
      throw new SpaceAdminError("INVALID_ARGUMENT", "spaceId is required");
    }
    if (!uri.trim()) {
      throw new SpaceAdminError("INVALID_ARGUMENT", "uri is required");
    }
    if (type !== "folder" && type !== "url") {
      throw new SpaceAdminError("INVALID_ARGUMENT", `Invalid resource type: ${type}`);
    }
  }
}
