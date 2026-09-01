# Codex timeout diagnostics

Agent Hub records Codex execution lifecycle without logging the prompt or command arguments.

Logged fields:
- execution mode/profile
- child PID
- timeout and cwd
- 60-second heartbeat with elapsed/idle seconds and stdout/stderr byte counts
- completion/failure reason and exit code
- on timeout only, redacted tail snapshots of stdout/stderr

Environment overrides:
- `CODEX_EXEC_HEARTBEAT_MS` (default `60000`, minimum effective interval `10000`)
- `CODEX_DIAGNOSTIC_TAIL_CHARS` (default `4000`)

The timeout value itself remains controlled by `CODEX_TIMEOUT_MS`; this diagnostic change does not alter it.
