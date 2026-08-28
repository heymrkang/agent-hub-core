# Agent Hub --- PROJECT PLAN

> **Document Version:** v1.0\
> **Status:** V1 Released\
> **Role:** Source of Truth for Agent Hub architecture and V1
> implementation

## 0. Document Rule

This document is the architectural and product source of truth for Agent
Hub.

-   When implementation changes an agreed design, update
    `PROJECT_PLAN.md` together with the code.
-   Do not silently implement undecided features.
-   Undecided ideas belong in **Decision Needed** or **Backlog**.
-   Provider-specific behavior must not be assumed. Verify the installed
    CLI capability first.
-   Do not hardcode provider model lists or behavior that can be
    discovered from the CLI.
-   Prefer native Codex/Gemini CLI capabilities over reimplementing them
    in Agent Hub.
-   If a capability is unsupported, report it explicitly rather than
    hiding the limitation behind unsafe automatic fallback.

------------------------------------------------------------------------

# 1. Project Vision

Agent Hub is a personal, Docker-first AI agent runtime controlled
primarily through Telegram.

The goal is not to create another LLM client. Agent Hub is the
persistent orchestration layer around CLI-based agents such as OpenAI
Codex CLI and Gemini CLI.

V1 should allow one owner to:

-   chat with CLI agents through Telegram;
-   create and switch persistent conversations;
-   select provider and model;
-   preserve sessions across container redeploys;
-   hand context between different providers;
-   inspect provider usage when the CLI exposes it;
-   schedule autonomous agent jobs;
-   maintain long-term personal memory;
-   upload multiple images/files;
-   access registered SSH servers;
-   allow agents to manage host Docker when permitted;
-   persist operational history in SQLite;
-   back up critical state;
-   recover cleanly after container restarts.

### V1 Definition

> **V1 = Telegram에서 Codex/Gemini를 세션 기반으로 안정적으로 운용하고,
> 세션·모델·Context·Scheduler·Memory·Attachment·SSH·Docker·Usage를 Agent
> Hub가 영속적으로 관리할 수 있는 상태.**

------------------------------------------------------------------------

# 2. Core Architecture Principles

## 2.1 Docker First

The application container is disposable.

``` text
Docker Image     = application/runtime
/data            = persistent Agent Hub state
Coolify ENV      = secrets and bootstrap configuration
Git Repository   = source code + architecture documentation
```

A container rebuild or redeploy must not destroy Agent Hub state.

## 2.2 SQLite as Canonical Operational Store

SQLite is the canonical store for Agent Hub-managed state:

-   users;
-   Agent Hub sessions;
-   messages;
-   attachments metadata;
-   provider-native session references;
-   handoffs;
-   jobs;
-   queues;
-   schedules;
-   schedule runs;
-   usage data when available;
-   SSH host registry;
-   settings;
-   backup metadata;
-   memory metadata;
-   operational state.

Provider-native sessions are execution contexts, **not** the canonical
Agent Hub conversation record.

## 2.3 Provider Isolation

Codex and Gemini are independent adapters.

Failure or authentication loss in one provider must not bring down Agent
Hub or another provider.

## 2.4 Capability-Driven Providers

Each provider adapter reports supported capabilities.

Typical capability states:

``` text
SUPPORTED
PARTIAL
UNSUPPORTED
```

Agent Hub must not pretend a capability exists.

Automatic fallback between providers is minimized in V1.

## 2.5 No Hardcoded Model Catalog

Provider/model selection is two-depth:

``` text
Phase 1: Provider
  Codex
  Gemini

Phase 2: model dynamically discovered from selected CLI
```

Model names must be discovered through provider-native mechanisms
whenever possible.

------------------------------------------------------------------------

# 3. High-Level Runtime

``` text
Telegram
   │
   ▼
Telegram Adapter / Auth Middleware
   │
   ▼
Agent Hub Core
   ├── Session Manager
   ├── Context Manager
   ├── Provider Manager
   ├── Job Runtime
   ├── Queue Manager
   ├── Scheduler Engine
   ├── Attachment Manager
   ├── Memory Manager
   ├── SSH Registry
   ├── Docker Integration
   ├── Usage Manager
   ├── Notification Manager
   ├── Backup Manager
   └── Health / Migration / Logging
          │
          ├────────── SQLite
          │
          └────────── /data
   │
   ├── Codex Adapter ── Codex CLI
   └── Gemini Adapter ─ Gemini CLI
```

------------------------------------------------------------------------

# 4. Persistent Data Layout

All persistent application data should converge under `/data`.

``` text
/data/
├── agent-hub.db
│
├── providers/
│   ├── codex/
│   └── gemini/
│
├── memory/
│   ├── PROFILE.md
│   ├── GOALS.md
│   ├── CURRENT.md
│   └── NOTES.md
│
├── ssh/
│   ├── keys/
│   ├── config
│   └── known_hosts
│
├── uploads/
│   └── <session-id>/
│
├── logs/
│
└── backups/
    ├── core/
    ├── full/
    └── migrations/
```

Provider authentication/configuration data must persist through
redeploys.

Secrets must not be stored in ordinary application logs.

------------------------------------------------------------------------

# 5. Telegram Access Control

V1 is intentionally single-user.

Authentication uses immutable Telegram numeric user ID, never Telegram
username.

Bootstrap configuration:

``` text
TELEGRAM_ADMIN_USER_ID=<numeric id>
TELEGRAM_BOT_TOKEN=<secret>
```

All Telegram update types must pass the same authentication middleware,
including:

-   messages;
-   commands;
-   images;
-   files;
-   callback queries;
-   inline-button interactions.

Unauthorized users receive no infrastructure information. Attempts are
logged internally.

Initial user role:

``` text
OWNER
```

The database should nevertheless be structured around a `users` entity
so future multi-user support does not require a schema redesign.

Multi-user roles/invitations are Backlog.

------------------------------------------------------------------------

# 6. Session Model

## 6.1 Session Semantics

A new Telegram conversation context is an Agent Hub session.

The user does not choose a topic before creating it. The topic emerges
from the conversation.

`/new` immediately creates a new session using defaults from
`/settings`:

-   default provider;
-   default model;
-   default execution profile.

Initial title:

``` text
새 채팅
```

After the first successful conversational exchange, Agent Hub may
generate the title once using the active provider.

The title is not repeatedly regenerated.

Manual rename locks the user-defined title.

## 6.2 Session Navigation

`/sessions` provides:

-   session list;
-   session switching;
-   rename;
-   archive/delete actions;
-   restore while within soft-delete retention;
-   running-job status.

Telegram cannot recreate Telegram-native historical chat threads. Agent
Hub therefore treats the selected session as the active logical context.

## 6.3 Rename

Both are supported:

``` text
/rename <새 제목>
```

and the `/sessions` UI rename action.

## 6.4 Soft Delete

Session deletion is soft deletion.

Retention:

``` text
30 days
```

During retention, the session and attachments remain recoverable.

After retention, an internal system job permanently removes eligible
session data and associated upload files.

------------------------------------------------------------------------

# 7. Native Provider Sessions

An Agent Hub session may contain multiple provider-native sessions.

Example:

``` text
Agent Hub Session #42
├── Codex Native Session ABC
└── Gemini Native Session XYZ
```

Switching models inside the same provider should use the provider's
native session/model behavior where supported.

Switching providers requires a context handoff.

Native session IDs/references are persisted in SQLite.

------------------------------------------------------------------------

# 8. Provider Handoff

SQLite is the canonical session context.

A provider handoff package can contain:

1.  relevant Global Memory;
2.  rolling session summary;
3.  working context;
4.  recent messages;
5.  relevant attachments;
6.  source provider/model;
7.  handoff metadata.

Do not blindly resend the entire historical conversation.

## 8.1 Incremental Handoff

When returning to a provider that already has a native session, reuse
that native session where reliable and synchronize changes made since
its last use.

Example:

``` text
Codex → Gemini → Codex
```

The second Codex transition should prefer:

``` text
existing Codex native session
+ changes since last Codex synchronization
```

If native-session reuse is unsupported or unsafe, create a new native
session and perform a full handoff package.

## 8.2 Transactional Handoff

The active provider changes **only after** handoff succeeds.

On failure:

-   retain the existing active provider;
-   preserve state;
-   report the failure clearly.

Record handoffs in SQLite for debugging and history.

------------------------------------------------------------------------

# 9. Context Management

There are two context layers:

``` text
Provider Native Context
Agent Hub Canonical Context
```

Agent Hub never treats native compacting as deletion of canonical
history.

SQLite retains original messages.

## 9.1 Native Context First

Prefer native Codex/Gemini context-management behavior.

Agent Hub should not reimplement provider behavior unnecessarily.

## 9.2 Automatic Compact

When context-window information is available, use a percentage threshold
rather than hardcoded token numbers.

Default threshold can initially be approximately 75%, but must be
configurable in `/settings`.

Exact defaults may be refined during implementation after CLI capability
verification.

## 9.3 Manual Compact

`/compact` requests provider-native compaction where supported.

Display actual before/after numbers only when supplied by the provider.

Never fabricate or estimate provider-reported compression metrics.

------------------------------------------------------------------------

# 10. Global Memory

Global Memory is independent of individual sessions.

Markdown files are the human-readable source of truth:

``` text
/data/memory/
├── PROFILE.md
├── GOALS.md
├── CURRENT.md
└── NOTES.md
```

SQLite stores metadata/history required to manage these files.

Meaning:

-   `PROFILE.md`: relatively stable user context;
-   `GOALS.md`: long-term goals;
-   `CURRENT.md`: current projects/priorities;
-   `NOTES.md`: other useful durable information.

Agents may update memory only when information is meaningfully durable.
Do not rewrite memory for every casual statement.

Memory modifications should leave an auditable change history.

## 10.1 `/memory`

V1 supports:

-   view;
-   edit;
-   delete;
-   inspect recent updates.

Scheduler jobs may read relevant Global Memory even though they execute
in isolated temporary contexts.

------------------------------------------------------------------------

# 11. Provider Adapter Contract

Both providers implement a common conceptual adapter.

Example interface:

``` text
ProviderAdapter

checkHealth()
checkAuth()
discoverModels()
getCapabilities()

createSession()
resumeSession()
sendMessage()
changeModel()

compact()
getUsage()

attachFiles()
stop()
```

Exact code signatures are implementation details.

Every capability must be verified against the pinned CLI version.

------------------------------------------------------------------------

# 12. Codex / Gemini V1 Parity Target

V1 aims for core behavioral parity where each CLI supports it:

-   authentication persistence;
-   normal prompts;
-   native sessions;
-   native session resume;
-   same-provider model changes;
-   dynamic model discovery;
-   usage/quota retrieval where exposed;
-   compact where exposed;
-   image/file handling where exposed;
-   Scheduler execution;
-   provider handoff;
-   error capture;
-   cancellation.

Unsupported features must be reported explicitly.

------------------------------------------------------------------------

# 13. Usage

`/usage` is a V1 feature.

It should distinguish:

## Provider quota/limits

Display only information actually exposed by the provider/CLI, such as
usage windows or quota information.

If Codex/Gemini exposes weekly, rolling-hour, or other usage windows,
render them.

If the CLI does not expose a metric:

``` text
Unavailable / Provider does not expose this value
```

Do not infer it.

## Agent Hub usage history

Agent Hub may calculate its own statistics from persisted Jobs:

-   job count;
-   execution duration;
-   provider/model distribution;
-   actual token counts when provided.

Token values that are not provided remain `NULL/UNKNOWN`.

Automatic high-usage warnings are Backlog.

------------------------------------------------------------------------

# 14. Attachments

Multi-attachment is the baseline, not an optional extension.

A single user message may contain:

-   multiple images;
-   multiple files;
-   text + multiple attachments.

Flow:

``` text
Telegram
   ↓
Agent Hub downloads attachment
   ↓
/data/uploads/<session-id>/
   ↓
metadata → SQLite
   ↓
path/attachment → Provider Adapter
```

Codex image attachment should use its native image mechanism when
appropriate.

Generic files may be exposed to the CLI as accessible workspace paths.

Attachments are associated 1:N with a message.

Suggested metadata:

``` text
attachment_id
message_id
type
original_name
stored_path
mime_type
size
telegram_file_id
created_at
```

Binary content is not stored in SQLite.

Attachments are long-term session context assets.

During provider handoff, relevant attachments can be selectively
reattached or referenced.

Old attachments remain discoverable from the session database until
lifecycle cleanup.

Audio/video analysis is Backlog.

------------------------------------------------------------------------

# 15. Response Renderer

Provider output is stored in SQLite as the original unfragmented
assistant response.

Telegram presentation is a separate layer.

V1 renderer requirements:

1.  safe Telegram Markdown handling;
2.  automatic long-response splitting;
3.  preserve code blocks where practical;
4.  never split the canonical DB message merely because Telegram
    requires multiple outgoing messages.

Very large automatic `.txt`/`.md` response conversion may be implemented
if low-cost; otherwise it is Backlog.

------------------------------------------------------------------------

# 16. Execution Profiles

Execution Profile is stored per session and per Scheduler definition.

Defaults are managed through `/settings`.

V1 profiles:

``` text
READ_ONLY
WORKSPACE
FULL_ACCESS
```

V1 should map these profiles as closely as practical onto native
Codex/Gemini sandbox/approval capabilities.

Do not build a sophisticated Agent Hub command permission engine in V1.

That belongs in Backlog.

------------------------------------------------------------------------

# 17. SSH Host Registry

SSH authentication is key-only.

Password authentication is excluded from V1.

Private keys are manually placed by the server administrator into the
persistent volume:

``` text
/data/ssh/keys/
```

Private-key contents are not stored in SQLite.

SQLite stores host metadata and key path/reference.

Suggested fields:

``` text
id
name
alias
host
port
username
identity_file
enabled
created_at
updated_at
```

## 17.1 Agent Hub Managed SSH Config

Agent Hub manages:

``` text
/data/ssh/config
/data/ssh/known_hosts
```

and makes this usable as the CLI's SSH configuration.

An agent should ideally be able to execute:

``` text
ssh dev-server
```

rather than needing IP/username details in every prompt.

## 17.2 `/servers`

V1 supports:

-   list hosts;
-   add;
-   edit;
-   disable/remove registration;
-   select key from files found in `/data/ssh/keys`;
-   connection test.

Deleting a host registration must **not** automatically delete the
private-key file.

Normal SSH host verification should be preserved; do not globally
disable host-key checking as a convenience shortcut.

------------------------------------------------------------------------

# 18. Docker Integration

V1 may mount the host Docker socket:

``` text
/var/run/docker.sock
```

This intentionally grants powerful Docker access to permitted agent
execution profiles.

V1 includes:

-   Docker socket integration;
-   Docker connectivity/health detection;
-   Docker status in `/status`.

A dedicated `/docker` management UI is Backlog.

------------------------------------------------------------------------

# 19. Job Runtime

All actual CLI executions should pass through a common Job abstraction
where practical.

Core states:

``` text
QUEUED
RUNNING
COMPLETED
FAILED
CANCELLED
INTERRUPTED
```

Scheduler-specific outcomes may additionally include:

``` text
SKIPPED
MISSED
```

Jobs record, when applicable:

-   job type;
-   session;
-   provider;
-   model;
-   state;
-   queued/start/end timestamps;
-   duration;
-   exit code;
-   error category;
-   actual provider usage/token values when exposed.

Do not fabricate missing usage values.

------------------------------------------------------------------------

# 20. Queue and Concurrency

Two queue levels exist:

``` text
Session Queue
    ↓
Provider Queue
    ↓
CLI Process
```

## Session Queue

Preserves ordering inside the same logical session.

## Provider Queue

Limits total concurrent processes for a provider.

Initial defaults:

``` text
Codex  = 2
Gemini = 2
```

These are configurable under `/settings → Runtime`.

A reasonable maximum cap should prevent accidental process explosions.

Scheduler jobs may wait for a provider slot only within a grace period;
if no slot becomes available, they may be marked `SKIPPED`.

------------------------------------------------------------------------

# 21. Active Session vs Running Job

Changing the active Telegram session does not cancel work.

Example:

``` text
Session A → Codex still running
User switches to Session B
Session B → new work can continue
Session A → finishes independently
```

When a background session completes, the notification identifies its
source session and provides a button to switch to it.

`/stop` applies to the current active session's running job.

Stopping work in another session is done through `/sessions` UI.

------------------------------------------------------------------------

# 22. Running Job Telegram UX

V1 does not require live token streaming.

Use a status message:

``` text
QUEUED
→ RUNNING
→ COMPLETED / FAILED / CANCELLED / INTERRUPTED
```

The UI may display:

-   provider/model;
-   session;
-   elapsed time;
-   queue position;
-   stop/cancel button.

On failure, provide a **manual** retry action.

Manual retry does not violate the V1 policy of no automatic Scheduler
retry.

Do not expose private chain-of-thought/reasoning.

------------------------------------------------------------------------

# 23. Scheduler Engine

Do **not** use OS cron as the primary scheduler.

Agent Hub owns scheduling internally and persists definitions/runs in
SQLite.

Scheduler tasks execute in isolated temporary execution contexts rather
than hijacking the user's currently active conversation.

A schedule definition includes, as applicable:

-   name;
-   schedule expression;
-   timezone;
-   provider;
-   model;
-   execution profile;
-   prompt/task;
-   timeout;
-   enabled state;
-   overlap policy;
-   next run.

Execution results are persisted for debugging/history.

## 23.1 Overlap Policy

V1:

``` text
SKIP
```

If the previous execution of the same schedule is still active, the next
occurrence is skipped.

Future:

``` text
QUEUE
PARALLEL
```

## 23.2 Retry

V1 automatic retry:

``` text
NONE
```

Failures are recorded and notified.

Retry policy is Backlog.

## 23.3 Timeout

Every schedule supports a configurable timeout.

## 23.4 Missed Runs

If Agent Hub was offline at the scheduled time, V1 does not
automatically replay missed executions after restart.

Where reliably detectable, record them as `MISSED`.

## 23.5 Natural-Language Scheduler Creation

V1 supports a hybrid flow:

``` text
Natural-language request
       ↓
Current AI provider extracts structured scheduler intent
       ↓
Agent Hub validates fields
       ↓
Telegram confirmation UI
       ↓
User explicitly approves
       ↓
Persist schedule
```

The AI structures intent; Agent Hub owns scheduling and validation.

Ambiguous dates/times require clarification rather than guessing.

The provider used to interpret the request does not have to be the
provider used to execute the scheduled task.

## 23.6 `/schedule`

Manual UI supports:

-   create;
-   list;
-   edit;
-   enable/disable;
-   execution history.

------------------------------------------------------------------------

# 24. Internal System Jobs

Agent Hub's scheduler infrastructure also runs internal jobs, logically
separated from user schedules.

Examples:

-   Core Backup;
-   soft-delete cleanup;
-   log cleanup/rotation.

System jobs should be distinguishable in SQLite from user schedules.

------------------------------------------------------------------------

# 25. Notification Policy

V1 notification channel:

``` text
Telegram only
```

Interactive jobs return normal responses.

Background events use explicit notifications.

Default notification behavior:

``` text
Background session job completed   → notify
Scheduler completed                → notify
Scheduler failed                   → notify

Backup succeeded                   → silent
Cleanup succeeded                  → silent
Migration succeeded                → silent

Backup failed                      → notify
System job failed                  → notify
Provider authentication problem    → notify
Important core-health problem      → notify
```

`/settings → Notifications` exposes reasonable ON/OFF controls.

------------------------------------------------------------------------

# 26. Restart / Redeploy Recovery

Running processes are not automatically resumed after Agent
Hub/container restart.

On startup:

``` text
RUNNING → INTERRUPTED
reason = AGENT_HUB_RESTART
```

This applies to normal jobs and scheduler runs.

Sessions, native-session references, messages, attachments and
persistent state remain.

Missed schedules are not replayed automatically.

------------------------------------------------------------------------

# 27. Backup Strategy

V1 automated backup:

``` text
Core Backup
Frequency: once daily
Retention: latest 7
```

Core backup contains critical Agent Hub state while excluding SSH
private keys by default.

Full Backup is manually initiated.

Logs do not need to be included by default.

SQLite must use a safe snapshot/backup mechanism; do not assume copying
an actively used database file is sufficient.

## 27.1 SSH Keys

SSH private keys are excluded from automatic backups by default.

They may only be included through an explicit future/admin-controlled
option.

## 27.2 `/backup`

V1 supports:

-   run backup now;
-   inspect backup list;
-   inspect/configure backup settings.

## 27.3 Restore

Telegram `/restore` is Backlog.

V1 restore is administrator-operated/documented, e.g. through an
application CLI or documented server procedure.

If the original `/data` volume survives, simply mounting it to a fresh
Agent Hub deployment should restore normal state without an explicit
logical restore.

------------------------------------------------------------------------

# 28. Database Migration

Schema changes use versioned migrations.

Conceptually:

``` text
migrations/
001_initial
002_...
003_...
```

On startup:

``` text
detect schema
   ↓
migration required?
   ↓ yes
safe pre-migration DB backup
   ↓
run migrations sequentially
   ↓
success → start
failure → abort startup
```

Migration failure must not silently continue with an unknown schema
state.

Automatic DB downgrade is not supported.

If the DB schema is newer than the application supports, startup fails
with a clear diagnostic.

`/status` shows application and schema versions.

------------------------------------------------------------------------

# 29. Logging

V1 uses structured logs with logical categories such as:

-   application;
-   providers;
-   scheduler;
-   errors.

Useful fields include:

``` text
timestamp
level
category
session_id
provider
model
event
duration_ms
error_code
```

Do not duplicate full conversation contents into ordinary logs when
SQLite already owns the canonical conversation.

Provider stderr/error detail may be preserved for debugging after secret
redaction.

Never log:

-   Telegram bot tokens;
-   provider auth tokens;
-   SSH private keys;
-   OAuth credentials;
-   other secrets.

Retention:

``` text
30 days
```

Implement rotation/cleanup.

Telegram `/logs` is Backlog.

------------------------------------------------------------------------

# 30. Error Handling

V1 establishes:

-   basic error taxonomy;
-   structured error logging;
-   user-safe error responses.

Complex automated recovery behavior is postponed.

Errors should be classifiable into areas such as:

``` text
PROVIDER_AUTH
PROVIDER_EXEC
PROVIDER_CAPABILITY
NETWORK
TIMEOUT
CANCELLED
DATABASE
SCHEDULER
SSH
DOCKER
ATTACHMENT
INTERNAL
```

Exact enum design is implementation detail.

------------------------------------------------------------------------

# 31. Health

Provide a lightweight internal HTTP endpoint:

``` text
GET /health
```

It exists for Docker/Coolify health checking, not as a public Agent Hub
API.

Core health and dependency health are separate.

Examples:

``` text
Codex unavailable       → core may remain healthy
Gemini unavailable      → core may remain healthy
SSH host offline        → core may remain healthy

SQLite unavailable      → unhealthy
critical core init fail → unhealthy
```

Docker `HEALTHCHECK` should use this endpoint or equivalent lightweight
check.

------------------------------------------------------------------------

# 32. `/status`

`/status` is the detailed human-facing operational overview.

It should eventually include information such as:

``` text
Agent Hub
Application Version
DB Schema Version
Core Health
Database
Scheduler
/data writability

Providers
Codex status
Gemini status

Infrastructure
Docker connection
SSH hosts

Current Session
Provider
Model
Execution Profile
Job state

Recent important failures where useful
```

Do not confuse `/status` with `/health`.

------------------------------------------------------------------------

# 33. `/providers`

V1 provider management UI.

It should expose, when available:

-   connected/auth-required state;
-   CLI version;
-   authentication state/method;
-   default/current model information;
-   dynamic model list;
-   usage link/view;
-   health refresh.

Provider login protocols remain provider-native.

Agent Hub may relay/display the official CLI-generated authentication
URL/device flow but should not invent a replacement authentication
protocol.

Provider authentication/configuration data persists under
`/data/providers`.

------------------------------------------------------------------------

# 34. Telegram Commands --- V1

``` text
/new                 Create new session immediately
/sessions            Session list / switch / manage
/rename <title>      Rename active session

/model               Select provider/model for active session
/providers           Provider state/auth/model management
/usage               Provider quota + Agent Hub usage
/compact             Manual context compaction

/schedule            Scheduler management
/memory              Global Memory management
/servers             SSH host management

/queue               Active-session queue information
/stop                Stop active-session running job

/backup              Backup management
/settings            User/default/runtime settings
/status              Detailed Agent Hub status
/help                Command help
```

Do not keep expanding the V1 command surface without an explicit
planning decision.

------------------------------------------------------------------------

# 35. `/settings`

V1 settings should cover at least:

### Defaults

-   default provider;
-   default model;
-   default execution profile.

### Context

-   auto-compact behavior/threshold where applicable.

### Runtime

-   Codex concurrency limit;
-   Gemini concurrency limit.

### User

-   timezone.

### Notifications

-   background completion;
-   Scheduler completion;
-   Scheduler failure;
-   system failures.

### Session

-   automatic title generation ON/OFF.

Additional settings require explicit design.

------------------------------------------------------------------------

# 36. SQLite Schema --- Initial Concept

This is a planning schema, not a frozen implementation schema.

Likely entities:

``` text
users
settings

sessions
messages
attachments
provider_sessions
provider_handoffs

jobs
job_usage

schedules
schedule_runs

ssh_hosts

memory_files
memory_history

backups

schema_migrations
```

Potential session fields:

``` text
id
user_id
title
title_locked
active_provider
active_model
execution_profile
rolling_summary
working_context
status
deleted_at
created_at
updated_at
```

Potential message fields:

``` text
id
session_id
role
text
provider
model
created_at
```

Provider-native state belongs in `provider_sessions`, not directly in
the canonical message history.

The implementation agent may normalize or adjust this schema when
justified, but architectural semantics must remain consistent with this
document.

------------------------------------------------------------------------

# 37. Suggested Source Structure

Exact structure may be adapted to the existing repository, but
separation of responsibilities should resemble:

``` text
src/
├── app/
├── telegram/
├── sessions/
├── context/
├── providers/
│   ├── provider-adapter
│   ├── codex/
│   └── gemini/
├── jobs/
├── scheduler/
├── attachments/
├── memory/
├── ssh/
├── docker/
├── usage/
├── notifications/
├── backup/
├── database/
│   └── migrations/
├── health/
├── logging/
└── config/
```

Avoid a single Telegram handler accumulating provider, database,
scheduler and shell logic.

------------------------------------------------------------------------

# 38. CLI Version Policy

Provider CLI versions should be pinned in the Docker build rather than
unintentionally tracking latest on every rebuild.

Reason:

``` text
CLI update
→ command/output/session behavior may change
→ Adapter may break
```

Updates are deliberate:

``` text
1. inspect new CLI version;
2. review changelog/help;
3. run capability tests;
4. update Adapter if necessary;
5. update pinned version;
6. redeploy.
```

If a provider eventually forces an incompatible update, adapt the
integration at that time.

------------------------------------------------------------------------

# 39. Capability Verification Required Before/While Implementing

Do not guess these behaviors.

For the pinned Codex CLI and Gemini CLI, verify:

-   exact authentication persistence path;
-   non-interactive prompt syntax;
-   native session creation/resume;
-   whether native session model changes are supported;
-   model-list discovery mechanism;
-   context-window information exposure;
-   context usage exposure;
-   compact command/API availability;
-   compact result metrics;
-   usage/quota information;
-   image attachment syntax;
-   multi-image behavior;
-   generic file behavior;
-   cancellation behavior;
-   exit codes;
-   machine-readable/JSON output modes if any;
-   native remote/session daemon functionality if relevant;
-   provider-specific sandbox/approval modes.

Record verified behavior in repository documentation/tests rather than
relying on memory.

------------------------------------------------------------------------

# 40. V1 Implementation Phases

The implementation agent should build vertically and keep the
application runnable after each phase.

## Phase 0 --- Baseline Audit

-   inspect current repository;
-   document current working Telegram → Codex flow;
-   pin known-working Codex CLI version;
-   establish persistent `/data`;
-   ensure secrets remain ENV-based;
-   update this plan if repository reality differs.

## Phase 1 --- Core Persistence

-   SQLite initialization;
-   versioned migrations;
-   users/settings;
-   sessions/messages;
-   `/new`, `/sessions`, `/rename`;
-   persistent active-session state;
-   Telegram owner authentication.

## Phase 2 --- Provider Abstraction

-   common Provider Adapter;
-   migrate current Codex integration into adapter;
-   provider health/auth;
-   model discovery;
-   `/model`;
-   `/providers`;
-   provider capability registry.

## Phase 3 --- Job Runtime

-   common Job model;
-   session queue;
-   provider queue;
-   concurrency limits;
-   cancellation;
-   `/queue`;
-   `/stop`;
-   Telegram running-state UX;
-   restart → `INTERRUPTED`.

## Phase 4 --- Context

-   canonical context;
-   rolling summary;
-   working context;
-   `/compact`;
-   auto compact integration;
-   provider-native session persistence;
-   transactional provider handoff;
-   incremental handoff where supported.

## Phase 5 --- Gemini

-   install/pin Gemini CLI;
-   persistent authentication;
-   Gemini Adapter;
-   native sessions;
-   dynamic models;
-   attachments;
-   usage/compact where supported;
-   handoff Codex ↔ Gemini.

## Phase 6 --- Attachments

-   Telegram image/file ingestion;
-   persistent upload layout;
-   1:N attachment model;
-   multiple images/files in one request;
-   provider-specific image handling;
-   attachment-aware handoff.

## Phase 7 --- Memory

-   Markdown Global Memory;
-   metadata/history;
-   `/memory`;
-   controlled agent updates;
-   relevant memory injection into normal/handoff/scheduled contexts.

## Phase 8 --- Scheduler

-   internal scheduler engine;
-   schedules/runs;
-   isolated execution context;
-   Provider/Model/Profile/Timeout;
-   overlap `SKIP`;
-   no automatic retry;
-   `/schedule`;
-   natural-language intent → confirmation flow;
-   Scheduler notifications/history.

## Phase 9 --- Infrastructure Integrations

-   SSH Registry;
-   `/servers`;
-   managed SSH config;
-   key scanning;
-   connection test;
-   Docker socket status;
-   execution-profile mapping.

## Phase 10 --- Operations

-   `/usage`;
-   `/status`;
-   `/health`;
-   Docker HEALTHCHECK;
-   structured/redacted logs;
-   30-day cleanup;
-   daily Core Backup;
-   retention 7;
-   `/backup`;
-   system jobs;
-   migration pre-backups.

## Phase 11 --- Hardening / V1 Release

-   restart/redeploy tests;
-   provider outage tests;
-   auth-loss tests;
-   SQLite migration failure tests;
-   attachment cleanup tests;
-   Scheduler overlap/timeout tests;
-   concurrency tests;
-   provider-handoff tests;
-   backup recovery rehearsal;
-   documentation;
-   mark V1.

------------------------------------------------------------------------

# 41. Backlog

Explicitly not required for V1:

-   `/docker` Telegram management UI;
-   `/logs`;
-   Telegram `/restore`;
-   automatic provider fallback;
-   high-usage threshold alerts;
-   Scheduler automatic retry;
-   Scheduler `QUEUE` overlap policy;
-   Scheduler `PARALLEL` overlap policy;
-   sophisticated Agent Hub command permission engine;
-   audio attachment/STT;
-   video analysis;
-   multi-user invitations/roles;
-   additional notification channels;
-   live token streaming;
-   aggressive automatic recovery;
-   automatic SSH private-key management/deletion.

New ideas should normally enter Backlog first rather than expanding V1
immediately.

------------------------------------------------------------------------

# 42. Non-Negotiable V1 Safety / Data Rules

1.  Never log secrets.
2.  Never store SSH private-key contents in SQLite.
3.  Never hardcode provider model lists when discovery is available.
4.  Never fabricate usage/context metrics.
5.  Never switch active provider before a handoff succeeds.
6.  Never delete canonical messages merely because native context was
    compacted.
7.  Never automatically delete SSH private-key files when a server
    registry entry is removed.
8.  Never replay interrupted normal jobs automatically after restart.
9.  Never replay missed Scheduler runs automatically in V1.
10. Never allow unauthorized Telegram users to reach agent execution.
11. Never silently downgrade an unsupported provider capability.
12. Never silently continue after a failed DB migration.
13. Keep `/data` persistent and the application container disposable.

------------------------------------------------------------------------

# 43. V1 Success Scenario

A successful V1 should support this flow:

``` text
User opens Telegram
      ↓
/new
      ↓
Codex default session created
      ↓
User chats and uploads several images/files
      ↓
Agent works against persistent context
      ↓
User changes Codex model
      ↓
Native session continues where supported
      ↓
User changes Provider to Gemini
      ↓
Transactional context handoff
      ↓
Gemini continues the same Agent Hub conversation
      ↓
User registers:
"매일 아침 8시에 Codex로 ... 실행해줘"
      ↓
AI extracts Scheduler intent
      ↓
User confirms Telegram UI
      ↓
Agent Hub Scheduler executes independently
      ↓
Result + history saved
      ↓
Telegram notification delivered
      ↓
Container is redeployed
      ↓
/data survives
      ↓
Sessions, memory, schedules, SSH registry,
provider auth where valid, and history remain
```

That is the V1 target.

------------------------------------------------------------------------

# 44. Current Planning Status

**Architecture:** V1 baseline agreed.\
**Next action:** repository implementation audit and Phase 0 execution.\
**Planning policy:** stop adding speculative V1 features unless
implementation reveals a genuine blocker.

When an implementation decision conflicts with this document, do not
silently choose one. Record the conflict and update the plan after an
explicit decision.
