# Phase 13: Mobile Preview Runtime & Preview Manager

**Status: IN PROGRESS (13-1 complete)**

## 1. 목표

V1 release baseline 위에 추가하는 첫 신규 기능으로, Telegram을 중심으로 모바일에서 다음 개발 루프를 완성한다.

> Telegram 요청 → Agent 코드 수정 → 개발 서버 실행 → 외부 Preview URL 생성 → 모바일 브라우저 확인 → Telegram에서 후속 수정

Agent Hub 자체의 별도 Web UI를 만드는 것이 목적이 아니다. Next.js, Vite 등 개발 중인 웹 애플리케이션의 dev server를 안전하고 관리 가능한 장기 실행 Preview Runtime으로 제공하는 것이 목적이다.

## 2. 현재 인프라 전제

- 홈서버는 외부 서비스 포트를 직접 개방하지 않는다.
- Cloudflare Tunnel을 이미 사용한다.
- 실제 wildcard domain은 `*.12190529.xyz`이다.
- Cloudflare Tunnel route는 wildcard host를 서버의 `localhost:80`으로 전달한다.
- Coolify의 Traefik proxy가 현재 서비스들의 hostname routing을 담당한다.
- Agent Hub Core는 Docker socket을 사용할 수 있다.
- `/home/dev`는 persistent development root이며 `/home/dev/workspace`를 Git repository 기본 영역으로 사용한다.
- Agent Hub는 Telegram, Session, Provider, Job Queue, Git/GitHub, SSH, Docker 인프라를 이미 보유한다.

## 3. 핵심 아키텍처

```text
Mobile Browser
      |
      | HTTPS
      v
Cloudflare
      |
      | *.12190529.xyz
      v
Cloudflare Tunnel
      |
      | localhost:80
      v
Coolify / Traefik
      |
      | preview wildcard route (one-time setup)
      v
Agent Hub Preview Gateway
      |
      | hostname -> preview registry lookup
      v
Preview Docker Container
      |
      v
Next.js / Vite / other dev server
```

### 핵심 원칙

- Preview마다 Cloudflare Tunnel을 새로 만들지 않는다.
- Preview마다 Coolify/Traefik 설정을 새로 수정하지 않는다.
- Coolify/Traefik에는 Preview Gateway로 전달하는 wildcard routing을 한 번만 구성한다.
- 동적인 `hostname → preview container` 매핑은 Agent Hub Preview Registry/Gateway가 담당한다.
- Agent Hub Core의 관리용 포트나 Docker daemon을 외부에 공개하지 않는다.

## 4. Preview Gateway

Preview Gateway는 Preview Runtime의 외부 진입점이다.

예:

```text
wedding-a31f.12190529.xyz
        ↓
Preview Gateway
        ↓
preview-a31f:3000
```

역할:

- 요청 Hostname 파싱.
- Preview Registry에서 대상 Preview 조회.
- RUNNING 상태 Preview만 reverse proxy.
- 존재하지 않거나 종료된 Preview는 명확한 unavailable 응답.
- Preview 접근을 activity로 기록할 수 있어야 한다.
- Gateway는 lightweight 별도 container 형태를 우선 설계한다.

## 5. Preview Runtime 격리

각 Preview는 Agent Hub Core 프로세스 내부의 단순 child process가 아니라 **별도 Docker Container**로 실행하는 것을 기본 정책으로 한다.

목적:

- Preview crash가 Agent Hub Core에 직접 영향을 주지 않음.
- start/stop/restart lifecycle이 명확함.
- CPU/RAM 사용량 관찰 가능.
- orphan process 관리가 쉬움.
- 여러 Preview를 독립적으로 실행 가능.
- 향후 resource limit 적용 가능.

### Agent Hub managed labels

Agent Hub가 생성하는 Preview Container에는 최소 다음 계열의 label을 부여한다.

```text
agent-hub.managed=true
agent-hub.type=preview
agent-hub.preview-id=<preview_id>
agent-hub.session-id=<session_id>
```

Agent Hub는 이 label을 기준으로 자신이 생성한 Preview만 관리/정리한다.
Coolify의 Docker cleanup은 보조 수단이며 Preview lifecycle의 canonical owner는 Agent Hub Core이다.

## 6. 동시 실행 제한

- 기본 최대 동시 Preview: **3개**.
- 초기 V1에서는 최대 3개 정책으로 운영한다.
- 향후 `/settings`에서 configurable limit으로 확장할 수 있다.
- Preview 목록에서 현재 사용량을 `2/3` 형태로 확인할 수 있어야 한다.
- 제한 초과 시 기존 Preview를 임의 종료하지 않고 사용자에게 명확히 알린다.

현재 서버 기준:

- Intel i7-1255U
- RAM 16GB
- SSD 128GB + HDD 2TB

실제 병목은 프로젝트별 dev server의 RAM 사용량일 가능성이 높으므로, 향후 container resource usage 표시 및 limit 기능을 확장 가능하게 설계한다.

## 7. Preview URL 규칙

URL은 **프로젝트 이름 + 짧은 랜덤 ID**를 기본으로 한다.

예:

```text
wedding-a31f.12190529.xyz
agenthub-19cd.12190529.xyz
landing-7b2e.12190529.xyz
```

규칙:

- 프로젝트 이름은 hostname-safe slug로 normalize.
- 짧은 랜덤 ID를 반드시 추가해 충돌을 방지한다.
- URL은 Telegram에서 사용자에게 직접 전달한다.
- Preview ID와 public hostname은 SQLite에 저장한다.

## 8. 접근 보안 정책

Phase 13 초기 구현에서는 **URL을 아는 사용자가 접근할 수 있는 방식**으로 확정한다.

### 반드시 지킬 경계

- Preview Manager 자체가 `.env` 내용을 외부에 노출하거나 전송하지 않는다.
- Git credential/token을 Preview URL에 포함하지 않는다.
- SSH private key를 Preview Container에 전달하지 않는다.
- Docker socket을 Preview Container에 mount하지 않는다.
- Agent Hub Core 내부 관리 endpoint를 Preview Gateway가 proxy하지 않는다.
- Preview 종료 시 해당 route는 즉시 사용할 수 없게 한다.

### 애플리케이션 환경변수 주의

웹 dev server를 외부에 공개한다고 해서 서버 환경변수가 자동으로 전부 브라우저에 노출되는 것은 아니다. 그러나 프레임워크별 public environment variable 규칙, 애플리케이션 코드, debug endpoint, error response 등에 의해 개발자가 직접 민감정보를 노출할 가능성은 존재한다.

따라서 Phase 13의 보안 경계는 다음과 같다.

> Preview Manager는 Agent Hub/호스트의 credential을 Preview에 불필요하게 전달하거나 노출하지 않는다. 개발 애플리케이션 자체가 응답으로 노출한 비밀정보까지 자동 보호하는 기능은 초기 범위가 아니다.

Cloudflare Access, OTP/login, Preview Gateway token/cookie 인증은 향후 보안 강화 항목으로 둔다.

## 9. 개발 서버 실행 방식

**Hybrid 방식**으로 확정한다.

### 자연어 기반

사용자는 Agent와 대화하면서 다음처럼 요청할 수 있다.

```text
이 프로젝트 실행해서 모바일에서 볼 수 있게 해줘.
```

Agent/Preview Manager는 가능한 경우 다음을 자동 처리한다.

1. 현재 Session/Workspace 확인.
2. 프로젝트 구조 확인.
3. package manager 감지.
4. dev script 감지.
5. Preview Container 생성.
6. dev server 실행.
7. 실제 listening port 감지.
8. Preview Registry 등록.
9. public URL 반환.

### 명령어 기반

사용자가 직접 상태를 확인하거나 명시적으로 제어할 수도 있어야 한다.

초기 command 후보:

```text
/preview
/preview start
/preview stop
/preview restart
/preview logs
```

고급 override 후보:

```text
/preview start pnpm dev
/preview start --port 3000
```

정확한 Telegram UI/UX, inline button 구성과 세부 command grammar는 구현 전 별도 UX 설계에서 확정한다.

## 10. Package Manager / Dev Command 자동 감지

자동 감지를 기본으로 하고 수동 override를 fallback으로 제공한다.

감지 후보:

- `pnpm-lock.yaml` → pnpm
- `package-lock.json` → npm
- `yarn.lock` → yarn
- 기타 package manager metadata는 구현 시 확장 가능
- `package.json`의 `scripts.dev` 우선 확인

자동 감지가 불가능하거나 모호하면 추정 실행하지 않고 사용자에게 명확한 선택/override를 요청한다.

## 11. Port 자동 감지

**Port 자동 감지는 필수 기능**으로 확정한다.

3000, 5173 등의 고정 포트를 전제로 하지 않는다.
Next.js 등은 기본 포트가 이미 사용 중일 경우 다른 포트로 실행될 수 있으므로 실제 실행 결과를 기준으로 판단해야 한다.

우선순위 예시:

1. dev server stdout/stderr에서 Local URL/port 감지.
2. Preview Container 내부의 실제 listening socket 확인.
3. framework/runtime metadata를 활용할 수 있으면 보조적으로 사용.
4. 자동 감지 실패 시 사용자 지정 `--port` fallback.

잘못된 port를 추정해서 Preview URL을 성공으로 표시하지 않는다.

## 12. Preview Lifecycle

Preview는 일반 Agent Job과 분리된 장기 실행 Runtime이다.

상태 모델 후보:

```text
STARTING
RUNNING
STOPPING
STOPPED
FAILED
EXPIRED
```

일반 Job Queue의 `QUEUED → RUNNING → COMPLETED` lifecycle에 Preview process를 억지로 포함하지 않는다.

### Idle TTL

기본 정책:

> **마지막 활동 이후 24시간 동안 활동이 없으면 자동 종료**

단순 생성 시점 +24시간이 아니라 `last_activity_at`을 기준으로 한다.

activity 후보:

- Preview URL 실제 접근.
- 해당 Preview의 restart.
- `/preview logs` 등 Preview 관리 동작.
- 연결된 프로젝트에 대한 의미 있는 Agent 작업.
- 기타 구현 시 명확하게 정의된 Preview interaction.

### `/settings`

Preview idle timeout을 향후 `/settings`에 통합한다.

후보:

```text
6시간
12시간
24시간 (기본)
48시간
수동 종료만
```

### 재시작 정책

초기 구현에서는 Agent Hub/Core 또는 서버 재시작 후 Preview를 자동 재기동하지 않는다.

- 기존 runtime은 `STOPPED` 또는 적절한 종료 상태로 reconcile.
- 사용자가 필요할 때 다시 시작한다.
- 자동 복구는 향후 기능으로 둔다.

## 13. Session / Workspace 연결

Preview는 반드시 Session과 Workspace context에 연결한다.

Preview metadata 후보:

```text
preview_id
session_id
workspace_path
project_name
slug
public_hostname
public_url
container_id
command
package_manager
port
status
started_at
last_activity_at
stopped_at
failure_reason
```

정책:

- Session을 전환해도 실행 중 Preview는 계속 살아있을 수 있다.
- `/sessions`와 향후 Session detail에서 연결 Preview 상태를 표시할 수 있도록 설계한다.
- 동일 Workspace에는 `STARTING`, `RUNNING`, `STOPPING` 상태 Preview를 하나만 허용한다.
- 종료 이력(`STOPPED`, `FAILED`, `EXPIRED`)은 유지할 수 있으며 새 Preview 생성을 막지 않는다.

## 14. Preview Process / Container 관리

Preview Manager가 담당한다.

필수 기능:

- create/start.
- stop/remove.
- restart.
- crash detection.
- logs tail/read.
- runtime status reconcile.
- orphan Preview detection/cleanup.
- container labels 검증.
- port detection.
- resource usage 조회 확장 가능 구조.

Preview Container에는 필요한 Workspace만 mount하고 Agent Hub의 민감 인프라는 전달하지 않는 것을 기본으로 한다.

특히 다음은 기본 mount 금지:

- `/var/run/docker.sock`
- `/data/ssh/keys`
- `/root/.codex`
- `/root/.gemini`
- GitHub token/Agent Hub secret을 포함한 Core environment 전체

프로젝트 실행에 필요한 application environment 전달 정책은 구현 단계에서 별도 보안 검토 후 최소 권한 원칙으로 확정한다.

## 15. Preview Registry

SQLite에 Preview의 canonical metadata를 저장한다.

역할:

- hostname → Preview lookup.
- Session/Workspace → Preview lookup.
- 상태/수명 관리.
- Gateway routing source.
- orphan/restart reconciliation.
- activity timestamp.

Gateway는 DB를 직접 공유하지 않고 Core의 내부 전용 Registry API를 사용한다. 이 API는 Docker 내부망에만 노출하며 외부 공개 API로 만들지 않는다.

### 13-1 완료 기준

- [x] 상태 모델과 허용 상태 전이 확정.
- [x] migration v12 및 Preview canonical metadata schema 추가.
- [x] Preview Registry CRUD와 Session/Workspace 조회 추가.
- [x] 프로젝트 slug + 4자리 랜덤 hex hostname 생성.
- [x] 동일 Workspace 활성 Preview 1개 제한.
- [x] 기본 최대 활성 Preview 3개 제한.
- [x] Registry 단위 테스트 추가.
- [x] Preview 프로젝트 디렉터리는 Docker Runtime에서 읽기/쓰기로 mount하기로 확정.
- [x] Gateway는 Core 내부 Registry API를 사용하기로 확정.

## 16. Telegram UX 방향

세부 UI는 구현 전에 사용자와 별도 협의한다.

현재 목표 예시:

```text
🖥 Preview · 2/3

● wedding
  wedding-a31f.12190529.xyz
  Port: 3000
  Uptime: 1h 24m

● landing
  landing-7b2e.12190529.xyz
  Port: 5173
  Uptime: 18m
```

Preview detail에서 향후 다음 action을 제공할 수 있다.

```text
🌐 열기
↻ 재시작
📋 로그
■ 종료
```

Stealth UI 설정이 활성화된 경우 Agent Hub의 기존 UI theme 정책을 그대로 따른다.
LLM 일반 답변 내용은 Preview UI 스타일 때문에 변조하지 않는다.

## 17. Settings 확장

Phase 13에서 최소 다음 Preview setting을 고려한다.

- Preview idle timeout: 기본 24시간.
- Max concurrent previews: 초기 기본/제한 3.

초기 구현에서 max preview를 고정 3으로 둘 수 있으나 schema/service는 향후 configurable하게 확장 가능한 구조를 선호한다.

## 18. Cleanup / Failure 정책

- Idle TTL 만료 시 Preview Container 종료/제거.
- 수동 stop 시 route 즉시 비활성화.
- dev server crash 감지 시 `FAILED` 처리.
- 실패한 Preview를 성공 URL로 표시하지 않는다.
- orphan container는 Agent Hub managed label을 기준으로 식별한다.
- Agent Hub가 생성하지 않은 container는 자동 삭제하지 않는다.
- cleanup failure는 Structured Logging에 남긴다.
- 필요 시 Notification Manager를 통해 중요한 Preview failure를 알릴 수 있도록 설계한다.

## 19. 보안 원칙

- 호스트의 신규 public port 개방 금지.
- Cloudflare Tunnel + existing ingress 구조 재사용.
- Preview Container에 Docker socket 금지.
- SSH private key 금지.
- Provider credential 금지.
- Agent Hub Core secret 전체 전달 금지.
- Preview hostname에 credential/token 삽입 금지.
- 로그 출력 시 기존 Agent Hub secret redaction 정책 재사용.
- Preview Gateway는 arbitrary host/port open proxy가 되어서는 안 된다.
- Registry에 등록되고 RUNNING인 Agent Hub managed Preview만 proxy한다.

## 20. 초기 구현 범위에서 제외

다음은 Backlog/후속 보안·UX 개선으로 둔다.

- Cloudflare Access 연동.
- OTP/login 기반 Preview 인증.
- Preview별 사용자/팀 권한.
- Public share workflow.
- 자동 screenshot/video capture.
- Agent Hub 자체 Web IDE/Web UI.
- 서버 재부팅 후 Preview 자동 복구.
- 무제한 Preview.
- Preview production deployment 기능.

## 21. 예상 생성 / 수정 대상

실제 파일명은 구현 당시 현재 구조를 다시 확인하고 확정한다.

예상 영역:

```text
src/preview/preview-manager.js
src/preview/preview-runtime.js
src/preview/preview-registry.js
src/preview/runtime-detector.js
src/preview/port-detector.js
src/preview/preview-cleanup.js
src/telegram/commands/preview.js
src/database/migrations/<next>_previews.sql
preview-gateway/
Dockerfile / docker runtime related files
/settings integration
/status integration (optional)
```

## 22. 구현 순서 제안

1. Preview schema / Registry.
2. Docker Preview Runtime.
3. Package manager / dev command detection.
4. Port detection.
5. Preview Gateway.
6. Cloudflare/Coolify/Traefik one-time wildcard routing 검증.
7. start/stop/restart/logs lifecycle.
8. Idle TTL / cleanup.
9. `/preview` Telegram command.
10. Natural language Agent integration.
11. `/settings` integration.
12. Stealth UI / Notification / Structured Logging integration.
13. Runtime security audit.
14. Mobile end-to-end test.

## 23. 테스트 / 검증 기준

- [ ] Next.js 프로젝트 Preview 생성 성공.
- [ ] Vite 계열 프로젝트 Preview 생성 성공.
- [ ] package manager 자동 감지.
- [ ] dev command 자동 감지.
- [ ] 3000이 사용 중인 상황에서도 실제 변경 port 자동 감지.
- [ ] 자동 port 감지 실패 시 명확한 fallback/error.
- [ ] Preview Container가 Agent Hub Core와 분리되어 실행.
- [ ] Preview Container에 Docker socket/SSH private key/Provider credential이 전달되지 않음.
- [ ] 프로젝트명 + 랜덤 ID hostname 생성.
- [ ] `*.12190529.xyz` ingress를 통해 모바일 외부 접속 성공.
- [ ] Preview 생성/삭제마다 Cloudflare Tunnel 또는 Traefik route를 개별 수정하지 않음.
- [ ] 최대 3개 동시 Preview 제한.
- [ ] Preview 3개가 서로 독립적으로 실행/종료됨.
- [ ] Session 전환 후에도 Preview 유지.
- [ ] `/preview`에서 상태 확인.
- [ ] start/stop/restart/logs 동작.
- [ ] Preview URL 접근 시 `last_activity_at` 갱신.
- [ ] 24시간 Idle TTL 정책 동작.
- [ ] `/settings` Preview timeout 영속화.
- [ ] dev server crash 시 FAILED 감지.
- [ ] stop/expire 후 public URL이 더 이상 해당 dev server로 proxy되지 않음.
- [ ] orphan cleanup이 Agent Hub managed container만 대상으로 함.
- [ ] Telegram 자연어 요청으로 Preview 생성 가능.
- [ ] Stealth UI에서도 Preview command UI가 기존 정책대로 렌더링.
- [ ] LLM 일반 답변은 Preview UI/Stealth 처리로 변조되지 않음.
- [ ] Agent Hub Core health가 Preview 하나의 crash로 unhealthy가 되지 않음.

## 24. Phase 완료 정의

Phase 13은 다음 모바일 개발 루프가 실제 홈서버 배포 환경에서 end-to-end로 검증되면 DONE으로 판단한다.

```text
Telegram에서 프로젝트 수정 요청
        ↓
Codex / Antigravity가 Workspace 코드 수정
        ↓
Preview Manager가 Docker dev runtime 실행
        ↓
실제 port 자동 감지
        ↓
프로젝트명-랜덤ID.12190529.xyz URL 제공
        ↓
외부 모바일 브라우저에서 결과 확인
        ↓
Telegram에서 후속 수정
        ↓
기존 Preview에서 변경 결과 확인
```

이 Phase까지 완료되면 Agent Hub Core V1은 **모바일에서 요청 → 코딩 → 실행 → 외부 확인 → 반복 수정**이 가능한 end-to-end Mobile Vibe Coding 환경을 제공하는 것을 목표로 한다.
