import type { EventBus, SpaceAdminService } from "@spaceskit/core";
import type { Logger } from "@spaceskit/observability";
import type {
  OrchestrationJournalRepository,
  SchedulerJobRepository,
  SchedulerJobRunRepository,
  SchedulerJobSpaceRepository,
  SpaceRepository,
} from "@spaceskit/persistence";
import type { OrchestratorCommandService } from "./orchestrator-command-service.js";
import type { SchedulerEvalCatalogService } from "./scheduler-eval-catalog-service.js";
import type { SpaceConfiguratorService } from "./space-configurator-service.js";
import type { SpaceSharingService } from "./space-sharing-service.js";

export interface SchedulerServiceOptions {
  jobs: SchedulerJobRepository;
  jobSpaces: SchedulerJobSpaceRepository;
  runs: SchedulerJobRunRepository;
  spaces: SpaceRepository;
  eventBus?: Pick<EventBus, "on">;
  orchestrationJournal?: Pick<OrchestrationJournalRepository, "list">;
  spaceAdminService: Pick<SpaceAdminService, "getSpace">;
  spaceTemplateService?: Pick<SpaceConfiguratorService, "createFromTemplate">;
  orchestratorCommandService: Pick<OrchestratorCommandService, "submitCommand">;
  evalCatalogService?: Pick<SchedulerEvalCatalogService, "getDefinition" | "listDefinitions">;
  spaceSharingService?: SpaceSharingService | null;
  logger?: Logger;
  now?: () => Date;
  executionTimeoutMs?: number;
}
