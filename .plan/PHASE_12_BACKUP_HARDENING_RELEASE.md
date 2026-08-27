# Phase 12: Backup, Recovery, Hardening & V1 Release

## Status

`PLANNED`

## 1. 목표

Phase 12는 Agent Hub Core V1의 마지막 단계다.

목표는 기능을 더 많이 추가하는 것이 아니라 다음을 보장하는 것이다.

1. 중요한 persistent state를 백업할 수 있다.
2. 실제로 복구할 수 있다.
3. 보안/운영 경계를 최종 감사한다.
4. Phase 1~11 핵심 기능을 회귀 테스트한다.
5. 문서와 runtime이 일치하는 상태에서 `Agent Hub Core V1`을 release-ready로 선언한다.

---

## 2. Backup Scope

백업 대상은 "없어지면 Agent Hub 운영 상태를 복구하기 어려운 persistent state"에 한정한다.

### 2.1 필수

- SQLite `/data/agent-hub.db`
- DB migration metadata 포함 전체 DB state
- `/data/ssh/config`
- `/data/ssh/known_hosts`
- Phase 10 persistent settings가 DB 외부 파일을 사용할 경우 해당 설정
- Agent Hub가 생성하는 필수 persistent metadata

### 2.2 SSH Private Key 정책

`/data/ssh/keys`의 Private Key는 매우 민감하다.

V1 기본 정책:

- 일반 application backup에 무조건 평문 포함하지 않는다.
- 포함 기능을 제공한다면 명시적 opt-in + 강한 경고 + 안전한 destination 전제가 필요하다.
- Backup 목록/Telegram output/log에 key 내용은 절대 표시하지 않는다.

### 2.3 Provider Credential 정책

- `/root/.codex`, `/root/.gemini` credential/session data 역시 일반 backup에 무조건 포함하지 않는다.
- Token/credential은 Coolify Secret 또는 provider persistent mount의 별도 운영 백업 정책 대상으로 본다.

### 2.4 Git Workspace

- `/workspace/repos`는 Git remote가 source of truth인 repository의 경우 전체 backup 필수 대상이 아니다.
- uncommitted work가 존재할 수 있으므로 backup UI에서 dirty repository 존재 여부를 경고할 수 있다.
- 전체 workspace archive는 V1 optional/manual 범위로 둔다.

---

## 3. Backup Manager

### 3.1 Backup 생성

- SQLite online-safe backup 방식 또는 안전한 snapshot 절차를 사용한다.
- 단순 live DB file copy로 consistency를 운에 맡기지 않는다.
- backup 작업 중 Core 전체를 불필요하게 장시간 정지하지 않는다.
- backup artifact는 persistent `/data/backups/` 아래 명확한 구조로 저장한다.

권장 구조:

```text
/data/backups/
  migrations/
  manual/
  scheduled/
```

Migration pre-snapshot과 운영 backup을 구분한다.

### 3.2 Metadata

각 backup에 최소 다음 정보를 관리한다.

- Backup ID
- Created at
- Type (`manual`, `scheduled`, `pre_restore`, `migration` 등)
- DB schema version
- Application version/commit 가능 시 기록
- Size
- Integrity/check result

Secret 내용은 metadata에 넣지 않는다.

### 3.3 Integrity

- Backup 생성 후 파일 존재/size 검증.
- 가능하면 SQLite integrity check 또는 restore-safe validation.
- 실패한 backup을 성공으로 표시하지 않는다.

---

## 4. `/backup` Telegram UI

Root 예시:

```text
Backup

Last successful backup
• 2026-08-27 22:00
• 14.2 MB
• Integrity: OK

[ 지금 백업 ]
[ 백업 목록 ]
[ 복구 ]
[ 보존 정책 ]
```

### 4.1 지금 백업

- 수동 backup 생성.
- 중복 클릭/동시 backup을 방지한다.
- 진행/완료/실패 상태를 명확히 표시한다.

### 4.2 백업 목록

- 최신순 pagination.
- created time/type/size/integrity 표시.
- Telegram button이 한 화면에 무한히 쌓이지 않게 한다.

### 4.3 Restore

Restore는 destructive operation이다.

필수 절차:

1. 대상 backup 선택.
2. Backup metadata/integrity 확인.
3. 명시적 confirmation UI.
4. 현재 상태의 `pre_restore` safety backup 생성.
5. Scheduler/DB writer 등 consistency에 영향을 주는 component를 안전하게 정지/격리.
6. Restore 수행.
7. DB schema/health 검증.
8. 실패 시 가능한 범위에서 safety backup으로 rollback/recovery path 제공.

한 번의 실수 클릭으로 즉시 restore하지 않는다.

---

## 5. Scheduled Backup & Retention

- Internal Scheduler를 재사용하여 자동 backup을 지원할 수 있다.
- 기본값은 보수적으로 설정한다.
- Retention은 count 또는 age 기반으로 관리한다.
- 최소 하나 이상의 최근 정상 backup을 retention cleanup이 실수로 모두 삭제하지 않도록 보호한다.
- backup cleanup failure가 Core를 죽이지 않는다.
- disk full 상황을 고려하여 backup 생성 전/후 capacity error를 명확히 처리한다.

권장 초기 정책은 구현 시 확정하되 `/settings`와 연결 가능한 구조로 만든다.

---

## 6. Production Hardening Audit

Phase 12에서 코드 + 실제 Coolify deployment를 함께 감사한다.

### 6.1 Telegram

- `TELEGRAM_ALLOWED_USER_IDS` allowlist enforcement.
- Slash command/callback authorization 우회 여부.
- Callback stale/replay 처리.
- 동일 Bot Token multiple polling `409 Conflict` 운영 문제를 최종 deployment checklist에 포함.
- Telegram output Markdown/HTML escaping.

### 6.2 Secrets

- Telegram Bot Token
- GH/GitHub Token
- SSH Private Key
- Codex/Gemini credentials

검사 항목:

- SQLite 평문 저장 여부
- Git repository commit 여부
- remote URL 포함 여부
- runtime log 노출 여부
- Telegram output 노출 여부
- thrown error/diagnostic object를 통한 accidental leak 여부

### 6.3 Execution Profiles

- `READ_ONLY` 실제 write denial 회귀 테스트.
- `WORKSPACE` `/workspace` write 허용 및 infrastructure credential/socket 비노출 확인.
- `FULL_ACCESS` 명시적 profile에서만 host Docker/SSH/Git infrastructure operation 가능함을 확인.
- restricted helper orphan container cleanup.
- sandbox/helper timeout 및 kill cleanup.

### 6.4 SSH

- Key `0600`, directory `0700`.
- Key path traversal 방지.
- Registry 삭제가 key file을 자동 삭제하지 않는 정책 확인.
- `known_hosts` persistence.
- unsafe global host key checking disable 금지.

### 6.5 Docker

- Docker socket 권한이 사실상 host-root 수준임을 운영 문서에 명시.
- `/status`/`/system` UI가 destructive Docker operation을 노출하지 않음.
- Docker daemon unavailable 시 graceful degradation.

### 6.6 Git

- Token redaction.
- credential helper 사용.
- repository path traversal 방지.
- dirty worktree에서 자동 destructive reset/clean 금지.
- Agent가 commit/push할 때 사용자의 FULL_ACCESS 의도 경계가 유지되는지 확인.

### 6.7 Database / Scheduler

- Migration ordering/idempotency.
- pre-migration snapshot.
- Scheduler duplicate execution protection.
- overlapping execution isolation.
- deleted/disabled schedule skip.
- system session cleanup.
- backup/restore 중 scheduler consistency.

---

## 7. Full V1 Regression Test

Phase 12 Audit에서는 최소 다음 end-to-end path를 다시 확인한다.

### Telegram / Session

- `/start`
- Slash command menu
- `/sessions` active/trash/pagination/empty-trash
- Session create/switch/delete/restore 관련 기존 기능
- `/profile`

### Providers / Models

- Codex request/response
- Antigravity request/response
- `/model` catalog refresh/cache
- provider/model switch

### Memory / Context

- Session context continuity
- Compact/manual-auto behavior
- System session isolation

### Scheduler

- Create
- List
- Execute
- Skip/overlap behavior
- Remove
- History

### Infrastructure

- Host Docker query
- SSH registry/test
- Agent `ssh dev` remote command
- Git clone/pull/status/commit/push
- `/workspace` redeploy persistence

### Settings / Health

- `/settings` persistence
- Stealth mode
- `/status` healthy/degraded behavior

### System

- `/system` Host/CPU/Memory/Disk/Docker metrics
- warning thresholds

### Backup / Restore

- Manual backup
- Integrity verification
- Restore confirmation
- pre-restore safety backup
- 실제 restore 후 Core 정상 startup/DB read

---

## 8. Documentation / Release

V1 완료 시 다음 문서를 runtime과 맞춘다.

- README setup/deployment
- Environment variable reference
- Coolify mount 목록
- GitHub Token 권한/설정
- SSH key placement
- Execution Profile security model
- Telegram command reference
- Backup/restore runbook
- Known limitations
- Troubleshooting (`409 Conflict`, Docker socket, provider auth/model refresh 등)

Phase 문서는 실제 완료된 구현만 `DONE`으로 표시한다.

---

## 9. V1 완료 기준

다음을 모두 만족해야 `Agent Hub Core V1 — DONE`으로 판정한다.

- [ ] Phase 10 Audit PASS/DONE.
- [ ] Phase 11 Audit PASS/DONE.
- [ ] Manual backup 성공.
- [ ] Backup integrity 검증 성공.
- [ ] 실제 restore E2E 성공.
- [ ] Secret leakage audit PASS.
- [ ] Execution Profile regression PASS.
- [ ] SSH/Docker/Git regression PASS.
- [ ] Scheduler regression PASS.
- [ ] Provider/Model/Session regression PASS.
- [ ] `/settings`, `/status`, `/system`, `/backup` runtime E2E PASS.
- [ ] README/deployment/runbook 최신화.
- [ ] Phase 12 Final Audit에서 blocker 없음.

## 10. 최종 산출물

- Phase 12 implementation
- Phase 12 Final Audit document
- Updated production README/runbook
- Verified backup artifact + restore procedure
- `Agent Hub Core V1 — DONE` 판정
