# Phase 19: Agent Extensibility — MCP & Skills

## Status

`PLANNED`

Phase 18은 Codex CLI와 Antigravity CLI가 제공하는 MCP 및 Skills를 Agent Hub에서 조회하고 안전하게 사용할 수 있게 한다. Agent Hub가 별도 MCP/Skill 실행 엔진을 구현하지 않고 Provider의 native 설정과 실행을 유지한다.

---

## 1. 설계 원칙

```text
Telegram / Agent Hub
        ↓
Extension Registry & Policy
        ├─ Codex adapter ─────> Codex native MCP / Skills
        └─ Antigravity adapter > Antigravity native MCP / Skills
```

- Provider native CLI와 설정 파일을 source of truth로 유지한다.
- Agent Hub는 공통 목록, 상태, scope, trust, 권한 정책과 감사 기록을 제공한다.
- Codex와 Antigravity의 기능 차이를 억지로 같은 명령이나 enum으로 위장하지 않는다.
- 기존 persistent mount인 `/root/.codex`, `/root/.gemini`, `/home/dev/workspace`를 보존한다.
- MCP/Skill 실행 결과는 일반 Provider 응답 lifecycle을 따르되 외부 side effect를 별도로 통제한다.
- 설치·인증·권한 관리는 조회·사용 기반이 검증된 다음 단계적으로 연다.

---

## 2. Canonical Extension Registry

Agent Hub가 표시하고 정책 판단에 사용할 최소 모델:

```text
Extension
├─ type: MCP | SKILL
├─ provider: CODEX | ANTIGRAVITY
├─ nativeId / displayName / version?
├─ scope: GLOBAL | PROJECT
├─ state: ENABLED | DISABLED | ERROR | UNAVAILABLE
├─ trust: TRUSTED | UNREVIEWED | BLOCKED
├─ source / installPath?       // secret 제거 후 표시
├─ capabilities[]
└─ permissions
   ├─ READ
   ├─ WRITE
   ├─ DESTRUCTIVE
   └─ AUTH_REQUIRED
```

규칙:

- registry는 native 설정을 복제해 독립 source of truth가 되지 않는다.
- Provider refresh 결과와 Agent Hub policy metadata를 구분해 저장한다.
- 전역/프로젝트 scope와 현재 session/workspace의 실제 적용 여부를 구분한다.
- 이름 충돌 시 Provider, scope, native ID를 포함한 안정적인 식별자를 쓴다.
- raw command, environment, OAuth token, API key는 일반 DB와 Telegram에 저장하지 않는다.

---

## 3. Phase 18A — Existing Extensions Discovery & Use

서버에서 이미 설치·설정된 MCP와 Skills를 안전하게 조회하고 실제 Provider Job에 로딩한다.

### 3.1 `/mcp`

- Provider별 MCP 목록, transport(stdio/HTTP), enabled 상태, auth 필요 여부 표시
- 현재 session/project에서 적용되는 MCP와 전역 등록만 된 MCP 구분
- 제한 시간 내 read-only health/capability probe
- 일부 Provider 실패가 다른 Provider 목록을 가리지 않게 독립 조회
- 상세 화면에 source가 아닌 redacted endpoint/command 정보만 표시

### 3.2 `/skills`

- Provider별 전역 및 프로젝트 Skill 목록 표시
- Skill 이름, 설명, scope, trust, 적용 여부, validation 상태 표시
- 프로젝트 Skill은 현재 workspace 경계를 벗어난 symlink/path를 허용하지 않는다.
- `SKILL.md`와 포함 resource의 존재 및 기본 구조를 검사하되 이 단계에서 자동 실행하지 않는다.

### 3.3 Provider 실행 연결

- Codex와 Antigravity가 각 native 위치에서 MCP/Skills를 실제 로딩하는지 확인한다.
- restricted/FULL_ACCESS profile별로 허용된 extension만 실행되게 한다.
- 목록에 표시됐지만 실행 시 로딩되지 않는 상태를 성공으로 숨기지 않는다.
- Core 재배포 후 native 설정과 프로젝트 Skill 적용 상태가 유지된다.

---

## 4. Phase 18B — Installation & Lifecycle Management

18A가 검증된 후 Telegram에서 제한된 설치·변경 기능을 제공한다.

### 4.1 MCP 관리

- Provider가 지원하는 native add/remove/enable/disable 명령을 adapter로 호출한다.
- stdio와 HTTP transport를 구분하고 schema validation을 적용한다.
- 설정 변경 전 redacted diff와 영향 scope를 보여주고 명시적 확인을 받는다.
- 변경 전 backup, 임시 파일 작성, validation, atomic replace/rollback을 적용한다.
- 실패 시 기존 native 설정을 유지한다.

### 4.2 Skill 관리

- 검증된 source에서 설치, update, disable, remove를 지원한다.
- source URL/repository, revision, content digest를 기록하고 가능하면 commit/version을 pin한다.
- 설치 전 `SKILL.md`, 포함 script, executable, symlink와 요구 권한을 검사한다.
- allowlist 없는 임의 remote script를 설치 직후 자동 실행하지 않는다.
- 프로젝트 Skill 변경은 해당 Git worktree의 사용자 변경으로 명확히 표시한다.

### 4.3 공급망 기준

- 기본 source 정책은 allowlist 또는 사용자가 명시한 repository/revision이다.
- archive path traversal, symlink escape, executable drop, oversized payload를 차단한다.
- update 시 이전 버전과 diff를 제공하고 자동 latest 추종을 기본값으로 두지 않는다.
- 삭제는 정확한 Provider/scope/path를 재확인하고 가능하면 복구 가능한 backup을 남긴다.

---

## 5. Phase 18C — Authentication, Permission & Audit

MCP의 외부 시스템 변경 권한을 Agent Hub profile과 별도로 통제한다.

### 5.1 인증

- HTTP OAuth, device flow, API key/environment secret 등 Provider가 실제 지원하는 방식만 제공한다.
- callback은 Cloudflare Tunnel/Access를 전제로 하고 inbound port를 직접 개방하지 않는다.
- token/secret은 전용 secret store 또는 Provider native credential store에 보관한다.
- Telegram message, SQLite 일반 field, log, backup에 credential을 남기지 않는다.
- logout/revoke와 만료·재인증 상태를 Provider별로 제공한다.

### 5.2 권한 정책

기존 `READ_ONLY`, `WORKSPACE`, `FULL_ACCESS`는 filesystem/infra 권한만으로 MCP side effect를 충분히 막지 못한다. Extension tool policy를 별도로 적용한다.

- tool capability를 `READ`, `WRITE`, `DESTRUCTIVE`, `AUTH_REQUIRED`로 분류한다.
- `READ_ONLY`에서는 외부 write/destructive tool을 기본 차단한다.
- `WORKSPACE`도 외부 서비스 변경 권한을 자동 부여하지 않는다.
- `FULL_ACCESS` 역시 destructive MCP 호출의 묵시적 승인이 아니다.
- write/destructive 호출은 대상, action, 핵심 argument를 보여주고 Telegram 확인을 받는다.
- 비밀값은 확인 화면과 audit payload에서 redaction한다.
- 분류 불명확한 tool은 최소 권한 원칙으로 차단하거나 확인 대상으로 둔다.
- session/project/provider/MCP/tool 단위 allow/deny 정책을 지원한다.

### 5.3 감사와 취소

- 누가, 언제, 어느 session/project에서 어떤 extension/tool을 호출했는지 기록한다.
- result status, duration, approval decision과 redacted target을 남긴다.
- 취소 가능한 실행은 Job cancellation과 연동하고 orphan MCP process를 정리한다.
- audit log 자체에 prompt 전체나 secret을 무차별 저장하지 않는다.

---

## 6. UX 및 장애 처리

- `/mcp`, `/skills` 첫 화면에 Provider별 count, enabled/error, refresh 시각을 표시한다.
- Provider CLI가 기능을 지원하지 않으면 `UNSUPPORTED`, 인증 문제면 `AUTH_REQUIRED`로 구분한다.
- native config parse 실패 시 원본을 덮어쓰지 않고 read-only 오류로 표시한다.
- health probe timeout이 일반 Provider Job을 막지 않게 별도 제한과 cache/single-flight를 둔다.
- MCP server crash, timeout, malformed response를 Provider 전체 장애로 오인하지 않는다.
- Skill instruction이 Agent Hub 보안 정책이나 사용자 지시와 충돌하면 상위 정책을 유지하고 충돌을 알린다.

---

## 7. 예상 변경 범위

- Provider capability contract에 MCP/Skills discovery와 native management 지원 상태 추가
- Extension Registry와 policy metadata schema
- Codex/Antigravity native config adapter 및 redacted parser
- `/mcp`, `/skills` command와 Telegram renderer/actions
- MCP health/cache/single-flight 및 process lifecycle 관리
- Skill validator, source pinning, install transaction과 rollback
- secret store/OAuth callback-device flow 연동
- tool permission classifier, approval gate, audit log
- Provider별 fixture/regression과 실제 extension E2E

구체적인 CLI 명령과 설정 경로는 pinned Codex/Antigravity 버전을 착수 시 probe해 capability 문서에 확정한다.

---

## 8. Acceptance / E2E

### 18A — 조회·사용

- [ ] `/mcp`에서 두 Provider의 native 목록, scope, 상태를 구분해 확인한다.
- [ ] `/skills`에서 전역/프로젝트 Skill과 실제 적용 상태를 확인한다.
- [ ] 설치된 read-only MCP와 프로젝트 Skill이 실제 Provider Job에서 로딩된다.
- [ ] 한 Provider의 parse/health 실패가 다른 Provider와 일반 Job을 막지 않는다.
- [ ] Core 재배포 후 native 설정과 project scope가 유지된다.
- [ ] secret, raw environment와 credential path가 UI/log/DB에 노출되지 않는다.

### 18B — 설치·관리

- [ ] MCP add/remove/enable/disable이 native 설정에 원자적으로 반영된다.
- [ ] 실패한 변경은 기존 설정으로 rollback된다.
- [ ] Skill source/revision/digest와 변경 diff를 확인하고 설치·update·remove한다.
- [ ] path traversal, symlink escape, unreviewed executable과 무고정 remote source가 차단된다.
- [ ] 전역과 프로젝트 변경이 의도한 scope 밖에 영향을 주지 않는다.

### 18C — 인증·권한

- [ ] OAuth/device/API-key 인증 상태와 revoke를 Provider별로 처리한다.
- [ ] credential이 Telegram, 일반 SQLite/log/backup에 남지 않는다.
- [ ] READ_ONLY/WORKSPACE에서 외부 write 권한이 자동 부여되지 않는다.
- [ ] write/destructive tool은 실행 전에 명시적 승인과 redacted audit를 남긴다.
- [ ] 거부·timeout·cancel 시 side effect와 orphan process가 최소화된다.
- [ ] Provider/CLI 업데이트 후 fixture와 실제 계정 smoke test가 통과한다.

---

## 9. 완료 조건

18A → 18B → 18C 순서로 gate를 통과한다. 조회·실행 연결과 권한 경계가 검증되기 전에는 Telegram 설치 및 OAuth 관리 기능을 열지 않는다.

최종적으로 다음 흐름을 Codex와 Antigravity 각각에서 통과해야 `DONE` 처리한다.

```text
기존 MCP/Skill 조회
-> project scope 적용 확인
-> 검증된 extension 설치/활성화
-> 인증
-> read tool 무승인 실행
-> write/destructive tool 승인 또는 거부
-> redacted audit 확인
-> disable/remove/rollback
-> Core 재배포 후 상태 확인
```
