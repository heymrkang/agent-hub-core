# Phase 10: Settings & Operations

## Status

`PLANNED`

## 1. 목표

Phase 10은 Agent Hub Core를 Telegram에서 장기간 운영하기 위한 사용자 설정과 자체 상태 진단 계층을 구축한다.

핵심 축은 다음 두 가지다.

1. `/settings` — 영속 사용자/운영 설정 콘솔
2. `/status` — Agent Hub Core 자체 Health / Observability 화면

Phase 10의 `/status`는 호스트 CPU/RAM/Disk를 상세 관리하는 Phase 11 `/system`과 구분한다. `/status`는 "Agent Hub 기능이 정상인가"에 집중한다.

---

## 2. Persistent Settings Store

### 2.1 저장소

- SQLite 기반 persistent settings table을 추가한다.
- 설정은 Core 재시작/Coolify redeploy 후에도 유지되어야 한다.
- 환경변수는 bootstrap/default 용도로 유지할 수 있으나, Telegram에서 변경 가능한 값은 DB 설정을 우선한다.
- 알 수 없는 key, 잘못된 enum/range/type 값은 저장하지 않는다.
- Secret(Token, SSH Private Key 등)은 settings table에 저장하지 않는다.

### 2.2 설정 적용 원칙

- 변경 가능한 설정은 가능한 한 즉시 runtime에 반영한다.
- 재시작이 필요한 설정은 UI에서 명확히 표시한다.
- 기존 세션에 영향을 주는 설정과 "새 세션부터 적용"되는 기본값을 구분한다.
- 설정 변경은 application log에 key와 변경 성공 여부만 기록하며 secret 값은 기록하지 않는다.

---

## 3. `/settings` Telegram UI

버튼이 한 화면에 난잡하게 쌓이지 않도록 category depth를 둔다.

권장 Root UI:

```text
Settings

[ Agent 기본값 ]
[ 실행 설정 ]
[ Telegram UI ]
[ Scheduler ]
[ 시스템 설정 ]
```

모든 submenu는 `뒤로`와 root 복귀 경로를 제공한다.

### 3.1 Agent 기본값

- Default Provider
  - `codex`
  - `antigravity`
- Default Model
  - 선택한 Provider의 현재 Model Catalog를 사용한다.
  - 하드코딩된 stale model 목록을 별도 유지하지 않는다.
- Default Execution Profile
  - `READ_ONLY`
  - `WORKSPACE`
  - `FULL_ACCESS`
- 새 세션 생성 시 위 기본값을 적용한다.
- 기존 세션의 명시적 Provider/Model/Profile은 임의로 덮어쓰지 않는다.

### 3.2 실행 설정

- Concurrency limit
  - 동시에 실행 가능한 Agent Job 수의 기본 제한.
  - 최소/최대 안전 범위를 둔다.
- Auto Compact threshold
  - Context 자동 compact 발동 임계값.
  - 기존 compact/context 시스템과 연결한다.
- Auto session title
  - ON/OFF.
  - OFF일 경우 자동 제목 생성을 수행하지 않는다.

### 3.3 Telegram UI

- Notifications
  - ON/OFF.
  - Scheduler 완료, background job 완료 등 선택 가능한 Hub notification의 master toggle 역할.
  - 사용자가 직접 요청한 command 응답 자체를 끄는 기능으로 사용하지 않는다.
- Stealth Mode
  - `NORMAL` / `STEALTH`.
  - STEALTH에서는 Agent Hub가 생성하는 command/status/menu UI의 화려한 컬러 이모지를 제거한다.
  - 검정/단색 기호 또는 plain text 중심으로 표시한다.
  - LLM Provider가 생성한 자연어 답변 본문은 강제로 변환하지 않는다.
  - 기능 의미와 경고 수준은 NORMAL/STEALTH에서 동일하게 유지한다.
- Telegram slash command menu와 실제 command 구현이 어긋나지 않도록 유지한다.

### 3.4 Scheduler

- Timezone
  - Scheduler 해석/표시에 사용할 IANA timezone.
  - 기본값은 deployment/user 환경에 맞는 값으로 bootstrap.
  - 잘못된 timezone 저장 금지.
- Scheduler notification 정책은 Notifications 설정과 일관되게 동작한다.
- 기존 등록 Schedule의 cron/interval 정의를 설정 변경만으로 파괴적으로 rewrite하지 않는다.

### 3.5 시스템 설정

- 현재 설정 요약.
- 기본값 복원 기능.
- 전체 reset은 확인 단계를 거친다.
- Secret이나 infrastructure credential을 `/settings`에서 노출하지 않는다.

---

## 4. `/status` Health / Observability

### 4.1 목적

`/status`는 Agent Hub Core 자체의 운영 가능 여부를 빠르게 확인한다.

Overall state:

- `HEALTHY` — 핵심 기능 정상.
- `DEGRADED` — Core는 동작하지만 일부 optional/infrastructure 기능 장애.
- `ERROR` — 핵심 기능이 정상적으로 동작할 수 없는 상태.

하나의 optional provider/integration 장애만으로 전체 Core를 무조건 ERROR 처리하지 않는다.

### 4.2 수집 대상

Core:

- Process uptime
- Application version/commit identifier가 안전하게 확인 가능하면 표시
- DB connectivity / migration state
- Scheduler running state
- Running / queued job count
- 최근 실패 job 수 또는 마지막 실패 요약(가능한 범위)

Providers:

- Codex availability/readiness
- Antigravity availability/readiness
- Model Catalog cache 상태/최근 refresh error
- Provider 하나가 실패해도 다른 provider/Core가 정상일 수 있음을 반영

Infrastructure:

- Docker daemon connectivity + running container summary
- Git/GitHub auth state (`READY`, `NOT_CONFIGURED`, `ERROR` 등; token 값 비표시)
- SSH Registry enabled/total host count
- SSH Host 전체에 매 `/status`마다 실제 network connection을 강제하지 않는다.

Storage:

- `/data` 접근 가능 여부
- `/workspace` 접근 가능 여부
- SQLite path 접근 가능 여부
- 상세 CPU/RAM/Disk utilization은 Phase 11로 넘긴다.

### 4.3 Health Service

- Telegram command와 독립적인 reusable `HealthService`/collector 계층을 둔다.
- 각 check는 timeout/error isolation을 가진다.
- 하나의 check 예외가 `/status` 전체 command를 crash시키지 않는다.
- check 결과는 최소 `status`, `summary`, 필요 시 `errorCode` 형태로 정규화한다.
- Secret/Token/Private Key/credential URL은 health output과 log에 노출하지 않는다.

### 4.4 `/status` 예시

```text
Agent Hub Status — HEALTHY

Core
• Uptime: 3h 21m
• Database: OK
• Scheduler: RUNNING
• Jobs: 0 running / 0 queued

Providers
• Codex: READY
• Antigravity: READY

Infrastructure
• Docker: OK / 13 running
• GitHub: READY
• SSH: 1/1 enabled

Storage
• /data: OK
• /workspace: OK
```

Stealth Mode가 활성화되어 있으면 동일 정보를 plain/monochrome UI로 렌더링한다.

---

## 5. 오류 및 안전 정책

- `/settings` callback payload는 허용된 setting/action만 처리한다.
- Telegram callback 재전송/중복 클릭이 설정을 손상시키지 않도록 idempotent하게 처리한다.
- 잘못된 DB setting 값이 존재해도 safe default로 복구 가능해야 한다.
- Health check가 외부 command를 실행할 경우 timeout을 둔다.
- `/status`는 destructive operation을 수행하지 않는다.
- FULL_ACCESS 전환 등 강한 권한 변경은 기존 `/profile` 책임으로 유지하고 `/settings`는 기본값만 관리한다.

---

## 6. 구현 예상 구성

- DB migration: persistent settings
- `src/settings/settings-manager.js`
- `src/health/health-service.js`
- `src/telegram/commands/settings.js`
- `src/telegram/commands/status.js`
- Telegram UI renderer/theme helper (`NORMAL` / `STEALTH`)
- Session creation/default application 연결
- Scheduler timezone/notification 연결
- Context compact/concurrency/title setting 연결
- Slash command menu 갱신

파일명은 실제 구현 구조에 맞춰 조정할 수 있다.

---

## 7. Acceptance / E2E

- [ ] `/settings` root/submenu pagination/depth가 정상 동작한다.
- [ ] Default Provider 변경 후 새 세션에 적용된다.
- [ ] Default Model 변경 후 새 세션에 적용된다.
- [ ] Default Execution Profile 변경 후 새 세션에 적용된다.
- [ ] Concurrency/Compact/Auto-title 설정이 실제 runtime 동작에 반영된다.
- [ ] Timezone 변경 후 Scheduler의 신규 시간 해석/표시가 일치한다.
- [ ] Notifications ON/OFF가 Hub notification에 반영된다.
- [ ] Stealth Mode ON/OFF 시 Hub UI theme이 즉시 전환된다.
- [ ] Redeploy 후 설정이 유지된다.
- [ ] `/status`가 Core/DB/Scheduler/Providers/Docker/Git/SSH/Storage를 표시한다.
- [ ] Docker 또는 GitHub 장애 시 Core가 살아 있으면 `DEGRADED`로 정확히 표현한다.
- [ ] Secret 값이 `/settings`, `/status`, runtime log에 노출되지 않는다.

## 8. 완료 조건

위 Acceptance를 실제 Coolify runtime에서 검증하고 별도 Phase 10 Audit 문서에서 PASS 판정을 받은 뒤 `DONE` 처리한다.
