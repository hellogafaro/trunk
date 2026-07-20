import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  type Automation,
  type AutomationCreateInput,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EnvironmentId,
  type OrchestrationReadModel,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import { AutomationService } from "../../../automation/AutomationService.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { createAutomationFromChat } from "./handlers.ts";

const projectId = ProjectId.make("project:automation-tool");
const threadId = ThreadId.make("thread:automation-tool");
const providerInstanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId: providerInstanceId, model: "gpt-5.4" } as const;
const now = "2026-07-19T12:00:00.000Z";

const readModel = {
  snapshotSequence: 1,
  updatedAt: now,
  projects: [
    {
      id: projectId,
      title: "Automation project",
      workspaceRoot: "/tmp/automation-tool",
      defaultModelSelection: modelSelection,
      scripts: [],
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
  ],
  threads: [
    {
      id: threadId,
      projectId,
      title: "Automation setup",
      modelSelection,
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: "full-access",
      branch: null,
      worktreePath: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      latestTurn: null,
      messages: [],
      session: null,
      activities: [],
      proposedPlans: [],
      checkpoints: [],
      deletedAt: null,
    },
  ],
} satisfies OrchestrationReadModel;

const snapshotService = ProjectionSnapshotQuery.of({
  getCommandReadModel: () => Effect.succeed(readModel),
  getSnapshot: () => Effect.succeed(readModel),
  getShellSnapshot: () => Effect.die("unused"),
  getArchivedShellSnapshot: () => Effect.die("unused"),
  getSnapshotSequence: () => Effect.succeed({ snapshotSequence: 1 }),
  getCounts: () => Effect.succeed({ projectCount: 1, threadCount: 1 }),
  getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
  getProjectShellById: () => Effect.succeed(Option.none()),
  getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
  getThreadCheckpointContext: () => Effect.succeed(Option.none()),
  getFullThreadDiffContext: () => Effect.succeed(Option.none()),
  getThreadShellById: () => Effect.succeed(Option.none()),
  getThreadDetailById: () => Effect.succeed(Option.none()),
});

const invocation = (capabilities: ReadonlySet<McpInvocationContext.McpCapability>) =>
  McpInvocationContext.McpInvocationContext.of({
    environmentId: EnvironmentId.make("environment:automation-tool"),
    threadId,
    providerSessionId: "provider-session:automation-tool",
    providerInstanceId,
    capabilities,
    issuedAt: 1,
    expiresAt: Number.MAX_SAFE_INTEGER,
  });

function withTestServices<A, E>(
  created: Ref.Ref<ReadonlyArray<AutomationCreateInput>>,
  capabilities: ReadonlySet<McpInvocationContext.McpCapability>,
  effect: Effect.Effect<
    A,
    E,
    | AutomationService
    | Crypto.Crypto
    | ProjectionSnapshotQuery
    | McpInvocationContext.McpInvocationContext
  >,
) {
  const service = AutomationService.of({
    snapshots: Stream.empty,
    getSnapshot: Effect.die("unused"),
    create: (input) =>
      Ref.update(created, (inputs) => [...inputs, input]).pipe(
        Effect.as({
          id: input.automationId,
          title: input.title,
          prompt: input.prompt,
          projectId: input.projectId,
          modelSelection: input.modelSelection,
          runtimeMode: input.runtimeMode,
          schedule: input.schedule,
          target: input.target,
          status: "active",
          stopReason: null,
          nextRunAt: now,
          createdAt: now,
          updatedAt: now,
        } satisfies Automation),
      ),
    update: () => Effect.die("unused"),
    setStatus: () => Effect.die("unused"),
    runNow: () => Effect.die("unused"),
    delete: () => Effect.die("unused"),
  });
  return effect.pipe(
    Effect.provideService(AutomationService, service),
    Effect.provideService(ProjectionSnapshotQuery, snapshotService),
    Effect.provideService(McpInvocationContext.McpInvocationContext, invocation(capabilities)),
    Effect.provide(NodeServices.layer),
  );
}

it.effect("creates schedules with the requested chat behavior", () =>
  Effect.gen(function* () {
    const created = yield* Ref.make<ReadonlyArray<AutomationCreateInput>>([]);
    for (const target of ["current-chat", "dedicated-chat", "new-chat-each-run"] as const) {
      yield* withTestServices(
        created,
        new Set(["automations"]),
        createAutomationFromChat({
          title: `Daily review ${target}`,
          prompt: "Review the current project.",
          schedule: { type: "cron", expression: "0 9 * * 1-5", timeZone: "Europe/Berlin" },
          target,
        }),
      );
    }

    const [current, dedicated, fresh] = yield* Ref.get(created);
    expect(current?.projectId).toBe(projectId);
    expect(current?.modelSelection).toBeNull();
    expect(current?.target).toEqual({ type: "existing-thread", threadId });
    expect(dedicated?.modelSelection).toEqual(modelSelection);
    expect(dedicated?.target.type).toBe("persistent-thread");
    expect(dedicated?.target.type === "persistent-thread" ? dedicated.target.threadId : "").toMatch(
      /^automation-thread:/,
    );
    expect(fresh?.modelSelection).toEqual(modelSelection);
    expect(fresh?.target).toEqual({ type: "fresh-thread" });
  }),
);

it.effect("rejects creation without the automation capability", () =>
  Effect.gen(function* () {
    const created = yield* Ref.make<ReadonlyArray<AutomationCreateInput>>([]);
    const result = yield* withTestServices(
      created,
      new Set(),
      Effect.exit(
        createAutomationFromChat({
          title: "Daily review",
          prompt: "Review the current project.",
          schedule: { type: "cron", expression: "0 9 * * 1-5", timeZone: "Europe/Berlin" },
        }),
      ),
    );
    expect(result._tag).toBe("Failure");
    expect(yield* Ref.get(created)).toEqual([]);
  }),
);
