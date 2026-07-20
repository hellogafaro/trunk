import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import {
  type Automation,
  type AutomationSchedule,
  type AutomationTarget,
  type AutomationUpdateInput,
  EnvironmentId,
  type ModelSelection,
  ProviderInstanceId,
  ProjectId,
  type RuntimeMode,
  ThreadId,
  isProviderAvailable,
} from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { automationEnvironment } from "../../state/automations";
import { useEnvironments } from "../../state/environments";
import { useProjects, useServerConfigs, useThreadShells } from "../../state/entities";
import { useAtomCommand } from "../../state/use-atom-command";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { buildThreadRouteParams } from "../../threadRoutes";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../ui/empty";
import { Input } from "../ui/input";
import { Clock3Icon, PlayIcon, PlusIcon, StopIcon, Trash2, XIcon } from "../ui/icons";
import { Textarea } from "../ui/textarea";
import { Spinner } from "../ui/spinner";
import { Calendar } from "../ui/calendar";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { DiffPanelShell } from "../DiffPanelShell";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";

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
  readonly runtimeMode: RuntimeMode;
  readonly scheduleKind: ScheduleKind;
  readonly dateTime: string;
  readonly time: string;
  readonly weekday: string;
  readonly cron: string;
  readonly timeZone: string;
}

const CREATE_ROUTINE_PROMPT =
  "Set up a routine with me. Interview me to produce the most accurate possible prompt: clarify the outcome, relevant project context, schedule and time zone, chat behavior, model, and permission level. Show me the complete routine and ask for confirmation before using the routine tools to create it. Prefer a dedicated chat and approval-required permissions unless I choose otherwise.";

function localDateTimeInput(offsetMs = 60 * 60 * 1_000): string {
  const date = new Date(Date.now() + offsetMs);
  return formatLocalDateTime(date);
}

function formatLocalDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseLocalDateTime(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  return Number.isNaN(date.getTime()) ? null : date;
}

const TIME_ZONE_OPTIONS = Array.from(
  new Set(["UTC", ...Intl.supportedValuesOf("timeZone")]),
  (value) => ({ value, label: value }),
);

interface AutomationSelectOption {
  readonly value: string;
  readonly label: string;
}

const TARGET_OPTIONS: ReadonlyArray<AutomationSelectOption> = [
  { value: "persistent-thread", label: "One routine chat" },
  { value: "fresh-thread", label: "New chat each run" },
  { value: "existing-thread", label: "Existing chat" },
];

const RUNTIME_MODE_OPTIONS: ReadonlyArray<AutomationSelectOption> = [
  { value: "approval-required", label: "Ask before changes" },
  { value: "auto-accept-edits", label: "Allow file edits" },
  { value: "full-access", label: "Full access" },
];

const SCHEDULE_OPTIONS: ReadonlyArray<AutomationSelectOption> = [
  { value: "once", label: "Once" },
  { value: "hourly", label: "Every hour" },
  { value: "daily", label: "Every day" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly", label: "Every week" },
];

const WEEKDAY_OPTIONS: ReadonlyArray<AutomationSelectOption> = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
].map((label, value) => ({ value: String(value), label }));

const MINUTE_OPTIONS: ReadonlyArray<AutomationSelectOption> = Array.from(
  { length: 60 },
  (_, minute) => ({
    value: String(minute),
    label: minute === 0 ? "On the hour" : `${minute} minutes past`,
  }),
);

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
    runtimeMode: "approval-required",
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
  const fields = schedule.expression.trim().split(/\s+/);
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  const validMinute = minute !== undefined && /^\d{1,2}$/.test(minute) && Number(minute) < 60;
  const validHour = hour !== undefined && /^\d{1,2}$/.test(hour) && Number(hour) < 24;
  const commonDateFields = fields.length === 5 && dayOfMonth === "*" && month === "*";
  const time =
    validHour && validMinute ? `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}` : "09:00";
  const scheduleKind: ScheduleKind =
    commonDateFields && hour === "*" && validMinute && dayOfWeek === "*"
      ? "hourly"
      : commonDateFields && validHour && validMinute && dayOfWeek === "*"
        ? "daily"
        : commonDateFields && validHour && validMinute && dayOfWeek === "1-5"
          ? "weekdays"
          : commonDateFields && validHour && validMinute && /^[0-6]$/.test(dayOfWeek ?? "")
            ? "weekly"
            : "custom";
  return {
    scheduleKind,
    dateTime: localDateTimeInput(),
    time: scheduleKind === "hourly" ? `00:${(minute ?? "0").padStart(2, "0")}` : time,
    weekday: scheduleKind === "weekly" ? (dayOfWeek ?? "1") : "1",
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
  const draft = scheduleToDraft(schedule);
  const time = draft.time;
  const label =
    draft.scheduleKind === "hourly"
      ? time.endsWith(":00")
        ? "Hourly"
        : `Hourly at :${time.slice(3)}`
      : draft.scheduleKind === "daily"
        ? `Daily at ${time}`
        : draft.scheduleKind === "weekdays"
          ? `Weekdays at ${time}`
          : draft.scheduleKind === "weekly"
            ? `${["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"][Number(draft.weekday)]} at ${time}`
            : "Advanced schedule";
  return `${label} · ${schedule.timeZone}`;
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

function draftUpdateInput(
  draft: Draft,
  automationId: Automation["id"],
): AutomationUpdateInput | null {
  if (!draft.title.trim() || !draft.prompt.trim() || !draft.projectId) return null;
  let schedule: AutomationSchedule;
  try {
    schedule = draftSchedule(draft);
  } catch {
    return null;
  }

  const modelSelection: ModelSelection | null =
    draft.targetKind === "existing-thread"
      ? null
      : draft.instanceId && draft.model
        ? { instanceId: ProviderInstanceId.make(draft.instanceId), model: draft.model }
        : null;
  if (draft.targetKind !== "existing-thread" && modelSelection === null) return null;
  if (draft.targetKind !== "fresh-thread" && !draft.threadId) return null;

  const target: AutomationTarget =
    draft.targetKind === "fresh-thread"
      ? { type: "fresh-thread" }
      : {
          type: draft.targetKind,
          threadId: ThreadId.make(draft.threadId),
        };

  return {
    automationId,
    title: draft.title.trim(),
    prompt: draft.prompt.trim(),
    projectId: ProjectId.make(draft.projectId),
    modelSelection,
    runtimeMode: draft.runtimeMode,
    fullAccessAcknowledged: draft.runtimeMode === "full-access",
    schedule,
    target,
  };
}

function updateSignature(input: AutomationUpdateInput): string {
  return JSON.stringify(input);
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

export function RoutinesPage() {
  const navigate = useNavigate();
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
  const draftRef = useRef(draft);
  const selectedRef = useRef<ScopedAutomation | null>(null);
  const updateAutomationRef = useRef(updateAutomation);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPersistedSignatureRef = useRef<string | null>(null);
  updateAutomationRef.current = updateAutomation;

  const selectedEnvironmentId = draft.environmentId
    ? EnvironmentId.make(draft.environmentId)
    : firstEnvironmentId;
  const selectedProjects = projects.filter(
    (project) => selectedEnvironmentId !== null && project.environmentId === selectedEnvironmentId,
  );
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
  const timeZoneOptions = useMemo(
    () =>
      TIME_ZONE_OPTIONS.some((option) => option.value === draft.timeZone)
        ? TIME_ZONE_OPTIONS
        : [{ value: draft.timeZone, label: draft.timeZone }, ...TIME_ZONE_OPTIONS],
    [draft.timeZone],
  );

  const toastError = useCallback((title: string, error: Error) => {
    toastManager.add(stackedThreadToast({ type: "error", title, description: error.message }));
  }, []);

  const persistDraft = useCallback(
    async (nextDraft: Draft) => {
      const current = selectedRef.current;
      if (current === null) return;
      const input = draftUpdateInput(nextDraft, current.automation.id);
      if (input === null) return;
      const signature = updateSignature(input);
      if (signature === lastPersistedSignatureRef.current) return;

      const result = await updateAutomation({ environmentId: current.environmentId, input });
      const error = mutationError(result);
      if (error) {
        toastError("Could not update routine", error);
      } else {
        lastPersistedSignatureRef.current = signature;
      }
    },
    [toastError, updateAutomation],
  );

  const flushAutosave = useCallback(() => {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    void persistDraft(draftRef.current);
  }, [persistDraft]);

  const changeDraft = useCallback(
    (nextDraft: Draft) => {
      draftRef.current = nextDraft;
      setDraft(nextDraft);
      if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        void persistDraft(draftRef.current);
      }, 400);
    },
    [persistDraft],
  );

  useEffect(
    () => () => {
      if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);
      const current = selectedRef.current;
      if (current === null) return;
      const input = draftUpdateInput(draftRef.current, current.automation.id);
      if (input === null || updateSignature(input) === lastPersistedSignatureRef.current) return;
      void updateAutomationRef.current({ environmentId: current.environmentId, input });
    },
    [],
  );

  const edit = (scoped: ScopedAutomation) => {
    flushAutosave();
    const { automation, environmentId } = scoped;
    const nextDraft = {
      ...emptyDraft(environmentId, automation.projectId),
      ...scheduleToDraft(automation.schedule),
      title: automation.title,
      prompt: automation.prompt,
      targetKind: automation.target.type,
      threadId: automation.target.type === "fresh-thread" ? "" : automation.target.threadId,
      instanceId: automation.modelSelection?.instanceId ?? "",
      model: automation.modelSelection?.model ?? "",
      runtimeMode: automation.runtimeMode,
    } satisfies Draft;
    selectedRef.current = scoped;
    setSelectedKey(`${environmentId}:${automation.id}`);
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    const input = draftUpdateInput(nextDraft, automation.id);
    lastPersistedSignatureRef.current = input === null ? null : updateSignature(input);
  };

  const startCreate = () => {
    if (!firstProject) {
      toastError("Could not start routine setup", new Error("Add a project first."));
      return;
    }
    void handleNewThread(scopeProjectRef(firstProject.environmentId, firstProject.id), {
      forceNew: true,
      initialPrompt: CREATE_ROUTINE_PROMPT,
    });
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
        <header
          className={cn(
            "workspace-topbar border-b border-border px-3 transition-[padding-left] duration-200 ease-linear motion-reduce:transition-none sm:px-5",
            isElectron && "drag-region",
            COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
          )}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <h1 className="text-sm font-medium text-foreground">Routines</h1>
            <Button
              size="xs"
              className="ml-auto [-webkit-app-region:no-drag]"
              onClick={startCreate}
            >
              <PlusIcon />
              Create
            </Button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {state.hasError && state.snapshots.length === 0 ? (
            <Empty className="min-h-full">
              <EmptyMedia variant="icon">
                <Clock3Icon />
              </EmptyMedia>
              <EmptyHeader>
                <EmptyTitle>Routines unavailable</EmptyTitle>
                <EmptyDescription>Reconnect the environment, then try again.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : state.isLoading && state.snapshots.length === 0 ? (
            <RoutinesLoadingState />
          ) : scopedAutomations.length === 0 ? (
            <Empty className="min-h-full">
              <EmptyMedia variant="icon">
                <Clock3Icon />
              </EmptyMedia>
              <EmptyHeader>
                <EmptyTitle>No routines yet</EmptyTitle>
                <EmptyDescription>
                  Have an agent run a prompt once or on a recurring schedule.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button size="xs" onClick={startCreate}>
                  <PlusIcon />
                  Create routine
                </Button>
              </EmptyContent>
            </Empty>
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
                          scoped.automation.status === "enabled"
                            ? "bg-success"
                            : "bg-muted-foreground/40",
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {scoped.automation.title}
                        </span>
                        <span className="mt-0.5 block truncate text-sm text-muted-foreground">
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
                    void perform("Could not run routine", () =>
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
                    selected.automation.status === "enabled" ? "Disable routine" : "Enable routine"
                  }
                  onClick={() =>
                    void perform("Could not change routine", () =>
                      setStatus({
                        environmentId: selected.environmentId,
                        input: {
                          automationId: selected.automation.id,
                          status: selected.automation.status === "enabled" ? "disabled" : "enabled",
                        },
                      }),
                    )
                  }
                >
                  {selected.automation.status === "enabled" ? <StopIcon /> : <PlayIcon />}
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  disabled={busy}
                  aria-label="Delete routine"
                  onClick={() => {
                    if (!confirm(`Delete “${selected.automation.title}”?`)) return;
                    if (saveTimerRef.current !== null) {
                      clearTimeout(saveTimerRef.current);
                      saveTimerRef.current = null;
                    }
                    void perform("Could not delete routine", () =>
                      deleteAutomation({
                        environmentId: selected.environmentId,
                        input: { automationId: selected.automation.id },
                      }),
                    ).then((deleted) => {
                      if (deleted) {
                        selectedRef.current = null;
                        setSelectedKey(null);
                      }
                    });
                  }}
                >
                  <Trash2 />
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Close routine details"
                  onClick={() => {
                    flushAutosave();
                    selectedRef.current = null;
                    setSelectedKey(null);
                  }}
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
                  onChange={(event) => changeDraft({ ...draft, title: event.target.value })}
                  placeholder="Daily brief"
                />
              </Field>
              <Field label="Prompt">
                <Textarea
                  value={draft.prompt}
                  onChange={(event) => changeDraft({ ...draft, prompt: event.target.value })}
                  placeholder="What should the agent do?"
                  className="min-h-32"
                />
              </Field>
              <div className="rounded-xl border border-border">
                <SectionTitle>Details</SectionTitle>
                <Row label="Status">
                  <Badge
                    variant={selected.automation.status === "enabled" ? "success" : "secondary"}
                  >
                    {selected.automation.status === "enabled" ? "Enabled" : "Disabled"}
                  </Badge>
                </Row>
                <Row label="Environment">
                  <AutomationSelect
                    ariaLabel="Environment"
                    value={draft.environmentId}
                    disabled={selected !== null}
                    options={environments.map((environment) => ({
                      value: environment.environmentId,
                      label: environment.label,
                    }))}
                    onValueChange={(environmentId) => {
                      const project = projects.find(
                        (candidate) => candidate.environmentId === environmentId,
                      );
                      changeDraft({
                        ...draft,
                        environmentId,
                        projectId: project?.id ?? "",
                        threadId:
                          draft.targetKind === "persistent-thread"
                            ? `automation-thread:${randomIdSuffix()}`
                            : "",
                        instanceId: project?.defaultModelSelection?.instanceId ?? "",
                        model: project?.defaultModelSelection?.model ?? "",
                      });
                    }}
                  />
                </Row>
                <Row label="Project">
                  <AutomationSelect
                    ariaLabel="Project"
                    value={draft.projectId}
                    options={selectedProjects.map((project) => ({
                      value: project.id,
                      label: project.title,
                    }))}
                    onValueChange={(projectId) => {
                      const project = selectedProjects.find(
                        (candidate) => candidate.id === projectId,
                      );
                      changeDraft({
                        ...draft,
                        projectId,
                        threadId:
                          draft.targetKind === "persistent-thread"
                            ? `automation-thread:${randomIdSuffix()}`
                            : "",
                        instanceId: project?.defaultModelSelection?.instanceId ?? draft.instanceId,
                        model: project?.defaultModelSelection?.model ?? draft.model,
                      });
                    }}
                  />
                </Row>
                <Row label="Runs in">
                  <AutomationSelect
                    ariaLabel="Runs in"
                    value={draft.targetKind}
                    options={TARGET_OPTIONS}
                    onValueChange={(value) => {
                      const targetKind = value as TargetKind;
                      changeDraft({
                        ...draft,
                        targetKind,
                        threadId:
                          targetKind === "persistent-thread"
                            ? selected?.automation.target.type === "persistent-thread"
                              ? selected.automation.target.threadId
                              : `automation-thread:${randomIdSuffix()}`
                            : "",
                      });
                    }}
                  />
                </Row>
                {draft.targetKind === "existing-thread" ? (
                  <Row label="Chat">
                    <AutomationSelect
                      ariaLabel="Chat"
                      value={draft.threadId}
                      placeholder="Choose a chat…"
                      options={selectedThreads.map((thread) => ({
                        value: thread.id,
                        label: `${thread.title}${thread.archivedAt ? " (archived)" : ""}`,
                      }))}
                      onValueChange={(threadId) => changeDraft({ ...draft, threadId })}
                    />
                  </Row>
                ) : (
                  <>
                    <Row label="Provider">
                      <AutomationSelect
                        ariaLabel="Provider"
                        value={draft.instanceId}
                        placeholder="Choose a provider…"
                        options={providers.map((provider) => ({
                          value: provider.instanceId,
                          label: provider.displayName ?? provider.instanceId,
                        }))}
                        onValueChange={(instanceId) => {
                          const provider = providers.find(
                            (candidate) => candidate.instanceId === instanceId,
                          );
                          changeDraft({
                            ...draft,
                            instanceId,
                            model: provider?.models[0]?.slug ?? "",
                          });
                        }}
                      />
                    </Row>
                    <Row label="Model">
                      <AutomationSelect
                        ariaLabel="Model"
                        value={draft.model}
                        placeholder="Choose a model…"
                        options={(selectedProvider?.models ?? []).map((model) => ({
                          value: model.slug,
                          label: model.name,
                        }))}
                        onValueChange={(model) => changeDraft({ ...draft, model })}
                      />
                    </Row>
                  </>
                )}
                <Row label="Permissions">
                  <AutomationSelect
                    ariaLabel="Permissions"
                    value={draft.runtimeMode}
                    options={RUNTIME_MODE_OPTIONS}
                    onValueChange={(value) =>
                      changeDraft({ ...draft, runtimeMode: value as RuntimeMode })
                    }
                  />
                </Row>
              </div>

              <div className="rounded-xl border border-border">
                <SectionTitle>Frequency</SectionTitle>
                <Row label="Repeat">
                  <AutomationSelect
                    ariaLabel="Repeat"
                    value={draft.scheduleKind}
                    options={
                      draft.scheduleKind === "custom"
                        ? [...SCHEDULE_OPTIONS, { value: "custom", label: "Advanced schedule" }]
                        : SCHEDULE_OPTIONS
                    }
                    onValueChange={(scheduleKind) =>
                      changeDraft({ ...draft, scheduleKind: scheduleKind as ScheduleKind })
                    }
                  />
                </Row>
                {draft.scheduleKind === "once" ? (
                  <Row label="At">
                    <DateTimePicker
                      value={draft.dateTime}
                      onValueChange={(dateTime) => changeDraft({ ...draft, dateTime })}
                    />
                  </Row>
                ) : null}
                {draft.scheduleKind === "hourly" ? (
                  <Row label="At minute">
                    <AutomationSelect
                      ariaLabel="Minute"
                      value={String(Number(draft.time.slice(3)))}
                      options={MINUTE_OPTIONS}
                      onValueChange={(value) => {
                        const minute = Math.max(0, Math.min(59, Number(value)));
                        changeDraft({ ...draft, time: `00:${String(minute).padStart(2, "0")}` });
                      }}
                    />
                  </Row>
                ) : draft.scheduleKind !== "once" && draft.scheduleKind !== "custom" ? (
                  <Row label="At">
                    <TimePicker
                      value={draft.time}
                      onValueChange={(time) => changeDraft({ ...draft, time })}
                    />
                  </Row>
                ) : null}
                {draft.scheduleKind === "weekly" ? (
                  <Row label="Day">
                    <AutomationSelect
                      ariaLabel="Day"
                      value={draft.weekday}
                      options={WEEKDAY_OPTIONS}
                      onValueChange={(weekday) => changeDraft({ ...draft, weekday })}
                    />
                  </Row>
                ) : null}
                {draft.scheduleKind === "custom" ? (
                  <Row label="Expression">
                    <Input
                      value={draft.cron}
                      onChange={(event) => changeDraft({ ...draft, cron: event.target.value })}
                      placeholder="0 9 * * 1-5"
                    />
                  </Row>
                ) : null}
                {draft.scheduleKind !== "once" ? (
                  <Row label="Time zone">
                    <AutomationSelect
                      ariaLabel="Time zone"
                      value={draft.timeZone}
                      options={timeZoneOptions}
                      onValueChange={(timeZone) => changeDraft({ ...draft, timeZone })}
                    />
                  </Row>
                ) : null}
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
                      {run.threadId && selected ? (
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() =>
                            void navigate({
                              to: "/$environmentId/$threadId",
                              params: buildThreadRouteParams(
                                scopeThreadRef(selected.environmentId, run.threadId!),
                              ),
                            })
                          }
                        >
                          Open chat
                        </Button>
                      ) : null}
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

function AutomationSelect(props: {
  readonly ariaLabel: string;
  readonly value: string;
  readonly options: ReadonlyArray<AutomationSelectOption>;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly onValueChange: (value: string) => void;
}) {
  const selectedOption = props.options.find((option) => option.value === props.value);

  return (
    <Select
      value={props.value || null}
      disabled={props.disabled}
      onValueChange={(value) => {
        if (value !== null) props.onValueChange(value);
      }}
    >
      <SelectTrigger aria-label={props.ariaLabel}>
        <SelectValue>{selectedOption?.label ?? props.placeholder ?? "Choose…"}</SelectValue>
      </SelectTrigger>
      <SelectPopup align="end" alignItemWithTrigger={false}>
        {props.options.map((option) => (
          <SelectItem hideIndicator key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

function TimePicker(props: {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
}) {
  return (
    <InputGroup>
      <InputGroupInput
        type="time"
        step="60"
        aria-label="Time"
        value={props.value}
        onChange={(event) => props.onValueChange(event.target.value)}
        className="[&_input]:appearance-none [&_input::-webkit-calendar-picker-indicator]:hidden [&_input::-webkit-calendar-picker-indicator]:appearance-none"
      />
      <InputGroupAddon align="inline-end">
        <Clock3Icon className="text-muted-foreground" />
      </InputGroupAddon>
    </InputGroup>
  );
}

function DateTimePicker(props: {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
}) {
  const selectedDate = parseLocalDateTime(props.value);
  const label = selectedDate
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(selectedDate)
    : "Choose date and time";

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="outline" className="w-full justify-start px-3 font-normal">
            <Clock3Icon />
            <span className="truncate">{label}</span>
          </Button>
        }
      />
      <PopoverPopup align="end" viewportClassName="p-0">
        <Calendar
          mode="single"
          selected={selectedDate ?? undefined}
          onSelect={(date) => {
            if (!date) return;
            const time = selectedDate ?? new Date();
            date.setHours(time.getHours(), time.getMinutes(), 0, 0);
            props.onValueChange(formatLocalDateTime(date));
          }}
        />
        <div className="border-t border-border p-3">
          <TimePicker
            value={selectedDate ? props.value.slice(11, 16) : "09:00"}
            onValueChange={(time) => {
              const date = selectedDate ?? new Date();
              const [hour = "9", minute = "0"] = time.split(":");
              date.setHours(Number(hour), Number(minute), 0, 0);
              props.onValueChange(formatLocalDateTime(date));
            }}
          />
        </div>
      </PopoverPopup>
    </Popover>
  );
}

function RoutinesLoadingState() {
  return (
    <div className="flex min-h-full items-center justify-center">
      <Spinner className="size-4 text-muted-foreground" aria-label="Loading routines" />
    </div>
  );
}

function Field(props: { readonly label: string; readonly children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{props.label}</span>
      {props.children}
    </label>
  );
}

function SectionTitle(props: { readonly children: ReactNode }) {
  return <h2 className="border-b border-border px-4 py-3 text-sm font-medium">{props.children}</h2>;
}

function Row(props: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center gap-4 border-b border-border px-4 py-2 last:border-b-0">
      <span className="w-24 shrink-0 text-sm text-muted-foreground">{props.label}</span>
      <span className="min-w-0 flex-1">{props.children}</span>
    </div>
  );
}
