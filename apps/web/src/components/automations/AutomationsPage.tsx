import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  type Automation,
  type AutomationSchedule,
  type AutomationTarget,
  EnvironmentId,
  type ModelSelection,
  ProviderInstanceId,
  ProjectId,
  ThreadId,
  isProviderAvailable,
} from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useMemo, useState } from "react";

import { automationEnvironment } from "../../state/automations";
import { useEnvironments } from "../../state/environments";
import { useProjects, useServerConfigs, useThreadShells } from "../../state/entities";
import { useAtomCommand } from "../../state/use-atom-command";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Clock3Icon, PlayIcon, StopIcon, Trash2, XIcon } from "../ui/icons";
import { Textarea } from "../ui/textarea";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { DiffPanelShell } from "../DiffPanelShell";

type ScheduleKind = "once" | "hourly" | "daily" | "weekdays" | "weekly" | "custom";
type TargetKind = AutomationTarget["type"];

interface ScopedAutomation {
  readonly environmentId: EnvironmentId;
  readonly automation: Automation;
}

interface Draft {
  readonly title: string;
  readonly prompt: string;
  readonly environmentId: string;
  readonly projectId: string;
  readonly targetKind: TargetKind;
  readonly threadId: string;
  readonly instanceId: string;
  readonly model: string;
  readonly scheduleKind: ScheduleKind;
  readonly dateTime: string;
  readonly time: string;
  readonly weekday: string;
  readonly cron: string;
  readonly timeZone: string;
}

const fieldClass =
  "h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/24";

const CREATE_AUTOMATION_PROMPT =
  "Let's set up a scheduled task together. First, explain how scheduled tasks work in ChatGPT. Then interview me to figure out what I need scheduled and when it should run.";

function localDateTimeInput(offsetMs = 60 * 60 * 1_000): string {
  const date = new Date(Date.now() + offsetMs);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function emptyDraft(environmentId = "", projectId = ""): Draft {
  return {
    title: "",
    prompt: "",
    environmentId,
    projectId,
    targetKind: "persistent-thread",
    threadId: "",
    instanceId: "",
    model: "",
    scheduleKind: "daily",
    dateTime: localDateTimeInput(),
    time: "09:00",
    weekday: "1",
    cron: "0 9 * * *",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  };
}

function scheduleToDraft(
  schedule: AutomationSchedule,
): Pick<Draft, "scheduleKind" | "dateTime" | "time" | "weekday" | "cron" | "timeZone"> {
  if (schedule.type === "once") {
    const date = new Date(schedule.runAt);
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return {
      scheduleKind: "once",
      dateTime: date.toISOString().slice(0, 16),
      time: "09:00",
      weekday: "1",
      cron: "0 9 * * *",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    };
  }
  return {
    scheduleKind: "custom",
    dateTime: localDateTimeInput(),
    time: "09:00",
    weekday: "1",
    cron: schedule.expression,
    timeZone: schedule.timeZone,
  };
}

function formatSchedule(schedule: AutomationSchedule): string {
  if (schedule.type === "once") {
    return `Once · ${new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(schedule.runAt))}`;
  }
  return `${schedule.expression} · ${schedule.timeZone}`;
}

function formatDate(value: string | null): string {
  if (value === null) return "Not scheduled";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function draftSchedule(draft: Draft): AutomationSchedule {
  if (draft.scheduleKind === "once") {
    return { type: "once", runAt: new Date(draft.dateTime).toISOString() };
  }
  const [hour = "9", minute = "0"] = draft.time.split(":");
  const expression =
    draft.scheduleKind === "hourly"
      ? `${minute} * * * *`
      : draft.scheduleKind === "daily"
        ? `${minute} ${hour} * * *`
        : draft.scheduleKind === "weekdays"
          ? `${minute} ${hour} * * 1-5`
          : draft.scheduleKind === "weekly"
            ? `${minute} ${hour} * * ${draft.weekday}`
            : draft.cron.trim();
  return { type: "cron", expression, timeZone: draft.timeZone.trim() };
}

function mutationError(result: unknown): Error | null {
  if (
    typeof result !== "object" ||
    result === null ||
    !("_tag" in result) ||
    result._tag !== "Failure"
  ) {
    return null;
  }
  const cause = squashAtomCommandFailure(
    result as unknown as Parameters<typeof squashAtomCommandFailure>[0],
  );
  return cause instanceof Error ? cause : new Error(String(cause));
}

function randomIdSuffix(): string {
  return Array.from(globalThis.crypto.getRandomValues(new Uint32Array(4)), (value) =>
    value.toString(16).padStart(8, "0"),
  ).join("");
}

export function AutomationsPage() {
  const { environments } = useEnvironments();
  const projects = useProjects();
  const threads = useThreadShells();
  const serverConfigs = useServerConfigs();
  const environmentIds = useMemo(
    () => environments.map((environment) => environment.environmentId),
    [environments],
  );
  const state = useAtomValue(automationEnvironment.snapshots(environmentIds));
  const updateAutomation = useAtomCommand(automationEnvironment.update, { reportFailure: false });
  const setStatus = useAtomCommand(automationEnvironment.setStatus, { reportFailure: false });
  const runNow = useAtomCommand(automationEnvironment.runNow, { reportFailure: false });
  const deleteAutomation = useAtomCommand(automationEnvironment.delete, { reportFailure: false });

  const scopedAutomations = useMemo(
    () =>
      state.snapshots.flatMap(({ environmentId, snapshot }) =>
        snapshot.automations.map((automation) => ({ environmentId, automation })),
      ),
    [state.snapshots],
  );
  const handleNewThread = useNewThreadHandler();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selected =
    scopedAutomations.find(
      ({ environmentId, automation }) => `${environmentId}:${automation.id}` === selectedKey,
    ) ?? null;
  const firstEnvironmentId = environments[0]?.environmentId ?? null;
  const firstProject = projects.find(
    (project) => firstEnvironmentId !== null && project.environmentId === firstEnvironmentId,
  );
  const [draft, setDraft] = useState<Draft>(() =>
    emptyDraft(firstEnvironmentId ?? "", firstProject?.id ?? ""),
  );

  const selectedEnvironmentId = draft.environmentId
    ? EnvironmentId.make(draft.environmentId)
    : firstEnvironmentId;
  const selectedProjects = projects.filter(
    (project) => selectedEnvironmentId !== null && project.environmentId === selectedEnvironmentId,
  );
  const selectedProject =
    selectedProjects.find((project) => project.id === draft.projectId) ?? null;
  const selectedThreads = threads.filter(
    (thread) =>
      selectedEnvironmentId !== null &&
      thread.environmentId === selectedEnvironmentId &&
      thread.projectId === draft.projectId,
  );
  const providers = (
    selectedEnvironmentId === null
      ? []
      : (serverConfigs.get(selectedEnvironmentId)?.providers ?? [])
  ).filter(
    (provider) =>
      provider.enabled &&
      provider.installed &&
      isProviderAvailable(provider) &&
      provider.models.length > 0,
  );
  const selectedProvider = providers.find((provider) => provider.instanceId === draft.instanceId);

  const edit = (scoped: ScopedAutomation) => {
    const { automation, environmentId } = scoped;
    setSelectedKey(`${environmentId}:${automation.id}`);
    setDraft({
      ...emptyDraft(environmentId, automation.projectId),
      ...scheduleToDraft(automation.schedule),
      title: automation.title,
      prompt: automation.prompt,
      targetKind: automation.target.type,
      threadId: automation.target.type === "fresh-thread" ? "" : automation.target.threadId,
      instanceId: automation.modelSelection?.instanceId ?? "",
      model: automation.modelSelection?.model ?? "",
    });
  };

  const startCreate = () => {
    if (!firstProject) {
      toastError("Could not start scheduled task setup", new Error("Add a project first."));
      return;
    }
    void handleNewThread(scopeProjectRef(firstProject.environmentId, firstProject.id), {
      forceNew: true,
      initialPrompt: CREATE_AUTOMATION_PROMPT,
    });
  };

  const toastError = (title: string, error: Error) => {
    toastManager.add(stackedThreadToast({ type: "error", title, description: error.message }));
  };

  const save = async () => {
    if (!draft.title.trim() || !draft.prompt.trim() || !draft.projectId || !draft.environmentId) {
      toastError("Automation is incomplete", new Error("Add a title, prompt, and project."));
      return;
    }
    let schedule: AutomationSchedule;
    try {
      schedule = draftSchedule(draft);
    } catch {
      toastError("Invalid schedule", new Error("Choose a valid future date and time."));
      return;
    }
    const modelSelection: ModelSelection | null =
      draft.targetKind === "existing-thread"
        ? null
        : draft.instanceId && draft.model
          ? { instanceId: ProviderInstanceId.make(draft.instanceId), model: draft.model }
          : (selectedProject?.defaultModelSelection ?? null);
    if (draft.targetKind !== "existing-thread" && modelSelection === null) {
      toastError("Model required", new Error("Choose a provider and model."));
      return;
    }
    if (draft.targetKind === "existing-thread" && !draft.threadId) {
      toastError("Chat required", new Error("Choose the chat this automation should use."));
      return;
    }

    if (!selected) return;
    const target: AutomationTarget =
      draft.targetKind === "fresh-thread"
        ? { type: "fresh-thread" }
        : draft.targetKind === "existing-thread"
          ? { type: "existing-thread", threadId: ThreadId.make(draft.threadId) }
          : {
              type: "persistent-thread",
              threadId: ThreadId.make(draft.threadId),
            };
    const input = {
      automationId: selected.automation.id,
      title: draft.title.trim(),
      prompt: draft.prompt.trim(),
      projectId: ProjectId.make(draft.projectId),
      modelSelection,
      schedule,
      target,
    };
    setBusy(true);
    const result = await updateAutomation({ environmentId: selected.environmentId, input });
    setBusy(false);
    const error = mutationError(result);
    if (error) {
      toastError("Could not save automation", error);
      return;
    }
  };

  const perform = async (label: string, operation: () => Promise<unknown>) => {
    setBusy(true);
    const result = await operation();
    setBusy(false);
    const error = mutationError(result);
    if (error) {
      toastError(label, error);
      return false;
    }
    return true;
  };

  const selectedRuns = selected
    ? (state.snapshots
        .find((snapshot) => snapshot.environmentId === selected.environmentId)
        ?.snapshot.runs.filter((run) => run.automationId === selected.automation.id) ?? [])
    : [];

  return (
    <div className="flex h-full min-h-0 flex-1 bg-background text-foreground">
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-border py-4 pr-5 pl-12 sm:px-5">
          <h1 className="text-lg font-semibold tracking-tight">Automations</h1>
          <Button size="sm" onClick={startCreate}>
            Create
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {state.isLoading && scopedAutomations.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              Loading automations…
            </div>
          ) : scopedAutomations.length === 0 ? (
            <div className="mx-auto flex max-w-sm flex-col items-center px-6 py-20 text-center">
              <div className="mb-4 flex size-10 items-center justify-center rounded-xl border border-border bg-muted/30">
                <Clock3Icon className="size-5 text-muted-foreground" />
              </div>
              <p className="font-medium">No automations yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Create one to run work while you’re away.
              </p>
              <Button size="sm" variant="outline" className="mt-5" onClick={startCreate}>
                Create automation
              </Button>
            </div>
          ) : (
            <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
              <div className="space-y-1">
                {scopedAutomations.map((scoped) => {
                  const key = `${scoped.environmentId}:${scoped.automation.id}`;
                  const active = selectedKey === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => edit(scoped)}
                      className={cn(
                        "group flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-accent/60",
                        active && "bg-accent",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-1.5 size-2 shrink-0 rounded-full",
                          scoped.automation.status === "active"
                            ? "bg-success"
                            : "bg-muted-foreground/40",
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {scoped.automation.title}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {formatSchedule(scoped.automation.schedule)} · Next{" "}
                          {formatDate(scoped.automation.nextRunAt)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </main>

      {selected ? (
        <DiffPanelShell
          mode="inline"
          className="max-sm:fixed max-sm:inset-0 max-sm:z-[100] max-sm:!w-full max-sm:!min-w-0 max-sm:!max-w-none max-sm:border-l-0"
          header={
            <>
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-medium">{selected.automation.title}</span>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void perform("Could not run automation", () =>
                      runNow({
                        environmentId: selected.environmentId,
                        input: { automationId: selected.automation.id },
                      }),
                    )
                  }
                >
                  <PlayIcon /> Run now
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  disabled={busy}
                  aria-label={
                    selected.automation.status === "active" ? "Stop automation" : "Start automation"
                  }
                  onClick={() =>
                    void perform("Could not change automation", () =>
                      setStatus({
                        environmentId: selected.environmentId,
                        input: {
                          automationId: selected.automation.id,
                          status: selected.automation.status === "active" ? "stopped" : "active",
                        },
                      }),
                    )
                  }
                >
                  <StopIcon />
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  disabled={busy}
                  aria-label="Delete automation"
                  onClick={() => {
                    if (!confirm(`Delete “${selected.automation.title}”?`)) return;
                    void perform("Could not delete automation", () =>
                      deleteAutomation({
                        environmentId: selected.environmentId,
                        input: { automationId: selected.automation.id },
                      }),
                    ).then((deleted) => {
                      if (deleted) setSelectedKey(null);
                    });
                  }}
                >
                  <Trash2 />
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Close automation details"
                  onClick={() => setSelectedKey(null)}
                >
                  <XIcon />
                </Button>
              </div>
            </>
          }
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            <div className="space-y-5">
              <Field label="Name">
                <Input
                  value={draft.title}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  placeholder="Daily brief"
                />
              </Field>
              <Field label="Prompt">
                <Textarea
                  value={draft.prompt}
                  onChange={(event) => setDraft({ ...draft, prompt: event.target.value })}
                  placeholder="What should the agent do?"
                  className="min-h-32"
                />
              </Field>
              <div className="rounded-xl border border-border">
                <SectionTitle>Details</SectionTitle>
                <Row label="Status">
                  <Badge
                    variant={selected.automation.status === "active" ? "success" : "secondary"}
                  >
                    {selected.automation.status}
                  </Badge>
                </Row>
                <Row label="Environment">
                  <select
                    className={fieldClass}
                    value={draft.environmentId}
                    onChange={(event) => {
                      const environmentId = event.target.value;
                      const project = projects.find(
                        (candidate) => candidate.environmentId === environmentId,
                      );
                      setDraft({
                        ...draft,
                        environmentId,
                        projectId: project?.id ?? "",
                        threadId: "",
                        instanceId: project?.defaultModelSelection?.instanceId ?? "",
                        model: project?.defaultModelSelection?.model ?? "",
                      });
                    }}
                  >
                    {environments.map((environment) => (
                      <option key={environment.environmentId} value={environment.environmentId}>
                        {environment.label}
                      </option>
                    ))}
                  </select>
                </Row>
                <Row label="Project">
                  <select
                    className={fieldClass}
                    value={draft.projectId}
                    onChange={(event) => {
                      const project = selectedProjects.find(
                        (candidate) => candidate.id === event.target.value,
                      );
                      setDraft({
                        ...draft,
                        projectId: event.target.value,
                        threadId: "",
                        instanceId: project?.defaultModelSelection?.instanceId ?? draft.instanceId,
                        model: project?.defaultModelSelection?.model ?? draft.model,
                      });
                    }}
                  >
                    {selectedProjects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.title}
                      </option>
                    ))}
                  </select>
                </Row>
                <Row label="Runs in">
                  <select
                    className={fieldClass}
                    value={draft.targetKind}
                    onChange={(event) => {
                      const targetKind = event.target.value as TargetKind;
                      setDraft({
                        ...draft,
                        targetKind,
                        threadId:
                          targetKind === "persistent-thread"
                            ? selected.automation.target.type === "persistent-thread"
                              ? selected.automation.target.threadId
                              : `automation-thread:${randomIdSuffix()}`
                            : "",
                      });
                    }}
                  >
                    <option value="persistent-thread">One automation chat</option>
                    <option value="fresh-thread">New chat each run</option>
                    <option value="existing-thread">Existing chat</option>
                  </select>
                </Row>
                {draft.targetKind === "existing-thread" ? (
                  <Row label="Chat">
                    <select
                      className={fieldClass}
                      value={draft.threadId}
                      onChange={(event) => setDraft({ ...draft, threadId: event.target.value })}
                    >
                      <option value="">Choose a chat…</option>
                      {selectedThreads.map((thread) => (
                        <option key={thread.id} value={thread.id}>
                          {thread.title}
                          {thread.archivedAt ? " (archived)" : ""}
                        </option>
                      ))}
                    </select>
                  </Row>
                ) : (
                  <>
                    <Row label="Provider">
                      <select
                        className={fieldClass}
                        value={draft.instanceId}
                        onChange={(event) => {
                          const provider = providers.find(
                            (candidate) => candidate.instanceId === event.target.value,
                          );
                          setDraft({
                            ...draft,
                            instanceId: event.target.value,
                            model: provider?.models[0]?.slug ?? "",
                          });
                        }}
                      >
                        <option value="">Choose a provider…</option>
                        {providers.map((provider) => (
                          <option key={provider.instanceId} value={provider.instanceId}>
                            {provider.displayName ?? provider.instanceId}
                          </option>
                        ))}
                      </select>
                    </Row>
                    <Row label="Model">
                      <select
                        className={fieldClass}
                        value={draft.model}
                        onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                      >
                        <option value="">Choose a model…</option>
                        {(selectedProvider?.models ?? []).map((model) => (
                          <option key={model.slug} value={model.slug}>
                            {model.name}
                          </option>
                        ))}
                      </select>
                    </Row>
                  </>
                )}
              </div>

              <div className="rounded-xl border border-border">
                <SectionTitle>Frequency</SectionTitle>
                <Row label="Repeat">
                  <select
                    className={fieldClass}
                    value={draft.scheduleKind}
                    onChange={(event) =>
                      setDraft({ ...draft, scheduleKind: event.target.value as ScheduleKind })
                    }
                  >
                    <option value="once">Once</option>
                    <option value="hourly">Hourly</option>
                    <option value="daily">Daily</option>
                    <option value="weekdays">Weekdays</option>
                    <option value="weekly">Weekly</option>
                    <option value="custom">Custom cron</option>
                  </select>
                </Row>
                {draft.scheduleKind === "once" ? (
                  <Row label="At">
                    <Input
                      type="datetime-local"
                      value={draft.dateTime}
                      onChange={(event) => setDraft({ ...draft, dateTime: event.target.value })}
                    />
                  </Row>
                ) : null}
                {draft.scheduleKind !== "once" && draft.scheduleKind !== "custom" ? (
                  <Row label="At">
                    <Input
                      type="time"
                      value={draft.time}
                      onChange={(event) => setDraft({ ...draft, time: event.target.value })}
                    />
                  </Row>
                ) : null}
                {draft.scheduleKind === "weekly" ? (
                  <Row label="Day">
                    <select
                      className={fieldClass}
                      value={draft.weekday}
                      onChange={(event) => setDraft({ ...draft, weekday: event.target.value })}
                    >
                      {[
                        "Sunday",
                        "Monday",
                        "Tuesday",
                        "Wednesday",
                        "Thursday",
                        "Friday",
                        "Saturday",
                      ].map((day, index) => (
                        <option key={day} value={index}>
                          {day}
                        </option>
                      ))}
                    </select>
                  </Row>
                ) : null}
                {draft.scheduleKind === "custom" ? (
                  <Row label="Cron">
                    <Input
                      value={draft.cron}
                      onChange={(event) => setDraft({ ...draft, cron: event.target.value })}
                      placeholder="0 9 * * 1-5"
                    />
                  </Row>
                ) : null}
                {draft.scheduleKind !== "once" ? (
                  <Row label="Time zone">
                    <Input
                      value={draft.timeZone}
                      onChange={(event) => setDraft({ ...draft, timeZone: event.target.value })}
                    />
                  </Row>
                ) : null}
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => edit(selected)} disabled={busy}>
                  Reset
                </Button>
                <Button size="sm" onClick={() => void save()} disabled={busy}>
                  {busy ? "Saving…" : "Save automation"}
                </Button>
              </div>
            </div>

            {selectedRuns.length > 0 ? (
              <div className="mt-8 border-t border-border pt-5">
                <h2 className="mb-3 text-sm font-medium">Previous runs</h2>
                <div className="space-y-1">
                  {selectedRuns.slice(0, 20).map((run) => (
                    <div
                      key={run.id}
                      className="flex items-start justify-between gap-4 rounded-lg px-2 py-2 text-sm hover:bg-muted/40"
                    >
                      <div>
                        <span className="capitalize">{run.status}</span>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(run.startedAt ?? run.createdAt)}
                          {run.coalescedCount > 0 ? ` · ${run.coalescedCount} coalesced` : ""}
                        </p>
                        {run.error ? (
                          <p className="mt-1 text-xs text-destructive">{run.error}</p>
                        ) : null}
                      </div>
                      <Badge
                        size="sm"
                        variant={
                          run.status === "succeeded"
                            ? "success"
                            : run.status === "failed"
                              ? "error"
                              : "secondary"
                        }
                      >
                        {run.trigger}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </DiffPanelShell>
      ) : null}
    </div>
  );
}

function Field(props: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{props.label}</span>
      {props.children}
    </label>
  );
}

function SectionTitle(props: { readonly children: React.ReactNode }) {
  return <h2 className="border-b border-border px-4 py-3 text-sm font-medium">{props.children}</h2>;
}

function Row(props: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <label className="flex min-h-12 items-center gap-4 border-b border-border px-4 py-2 last:border-b-0">
      <span className="w-24 shrink-0 text-sm text-muted-foreground">{props.label}</span>
      <span className="min-w-0 flex-1">{props.children}</span>
    </label>
  );
}
