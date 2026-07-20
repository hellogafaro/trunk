# Automations

Automations run an agent prompt once or on a recurring cron schedule. They are designed for simple routines: choose a project, prompt, schedule and time zone, chat behavior, model, and permission level.

## Execution model

- The server must be online when work is due. After downtime, missed occurrences are coalesced into one queued run instead of replaying a burst.
- Scheduled and manual runs use the same durable queue. Each automation has at most one running and one queued run.
- A database lease ensures only one server scheduler claims due work. Advancing the schedule and inserting or coalescing the run happen in one transaction.
- One-time automations stop after their first occurrence is queued, whether the attempt later succeeds or fails.
- On restart, recorded running turns are reconciled with the orchestration projection. Runs are only failed when their turn cannot be recovered.

## Chat behavior

- **One automation chat** (default): reuse a dedicated chat so the routine keeps its own context.
- **New chat each run**: create an independent chat for every run.
- **Existing chat**: add runs to a selected chat; busy chats wait rather than receiving concurrent turns.

## Permissions

New automations default to **Ask before changes** (`approval-required`). File-edit access can be allowed without unrestricted commands. **Full access** must be explicitly acknowledged in the editor or agent tool because it may run commands and change the project without approval.

## Lifecycle

- **Disable** cancels queued work and clears the next schedule. A run already in progress is allowed to finish.
- **Enable** validates the project, model, target, and future schedule again.
- **Run now** queues work even when an automation is disabled, except when its target chat was deleted.
- **Delete** interrupts active turns where possible, cancels actionable runs, and tombstones the definition while preserving terminal history in storage.

The Automations page is the primary setup surface. Chat setup remains available as an optional shortcut, and agents with the `automations` capability can list, create, update, enable/disable, run, and delete routines.
