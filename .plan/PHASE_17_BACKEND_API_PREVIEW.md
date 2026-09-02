# Phase 17: Backend HTTP Preview & OpenAPI Discovery

## Status

`IN_PROGRESS`

진행 현황:

- [x] 17-0 기준선 및 데이터 계약: runtime/framework/API endpoint/Access 메타데이터와 v14 migration, 기존 `WEB` Preview 보정
- [x] 17-1 NestJS 테스트 fixture: Swagger 미설치/설치 독립 프로젝트, 메모리 CRUD·upload·SSE, 고정 버전/lockfile, 자체 HTTP 테스트
- [x] 17-2 NestJS 감지와 실행 명령 결정
- [x] 17-3 HTTP readiness와 실패 진단: Docker hostname HTTP probe 이후에만 RUNNING, 404 허용, localhost bind/timeout/process exit 진단, command·exit·redacted log·수정 힌트 제공
- [x] 17-4 OpenAPI/Swagger 탐지: source direct literal 우선 + 제한 후보 probe, HTML/JSON signature 검증, override와 health 탐지, 문서 미탐지 허용
- [x] 17-5 Gateway HTTP 호환성 보강: method/query/body/header 보존, multipart·SSE·WebSocket 회귀, host-only cookie, forwarded metadata, OpenAPI same-origin 보정
- [x] 17-6-1 외부 공개 보안 경계: 실제 Cloudflare Access challenge probe, Gateway route와 Telegram URL fail-closed
- [x] 17-6-2 개발 데이터 격리: env allowlist/.env masking, 개발 DB·R2 target guard, container 권한 축소, OpenAPI/log secret 제거
- [x] 17-7 Telegram API Preview UI: API/Web 구분, runtime·OpenAPI·health·dev 경고 표시, Access 검증 기반 endpoint action
- [x] 17-8 자동 E2E와 재시작 복구: 실제 Docker fixture lifecycle, restart/Core 재기동 HTTP 재검증, stop·expiry·route/container cleanup
- [ ] 17-9 MariaDB 및 실제 서버 공동 검증: 격리 MariaDB 자동 E2E 완료, 실제 Coolify/Telegram 공동 검증 대기

Phase 17은 기존 Preview Manager를 HTTP 백엔드 개발 서버까지 확장한다. 첫 지원 대상은 NestJS이며, Agent Hub가 API 문서 엔진을 새로 만들지 않고 프로젝트가 제공하는 OpenAPI/Swagger UI와 실제 API를 안전하게 프록시한다.

---

## 1. 목표와 범위

- NestJS 프로젝트를 감지하고 Preview runtime으로 실행한다.
- 프로젝트가 제공하는 Swagger UI와 OpenAPI JSON endpoint를 탐지한다.
- Telegram Preview UI에서 API 문서, health, 로그, 재시작, 종료 기능을 제공한다.
- Swagger `Try it out`을 포함한 실제 HTTP 요청을 Preview Gateway가 그대로 전달한다.
- 기존 Web/Mobile Preview lifecycle, routing, cleanup 모델을 재사용한다.
- 구조는 OpenAPI 기반 FastAPI 등으로 확장 가능하게 두되 Phase 17의 필수 E2E는 NestJS로 제한한다.

범위에서 제외한다.

- Agent Hub 자체 범용 Swagger/ReDoc 렌더러 개발
- OpenAPI가 없는 코드에서 문서를 자동 추론해 생성
- 운영 API나 운영 DB를 Preview 대상으로 연결
- 임의의 비 HTTP daemon과 production deployment 관리

```text
Cloudflare Access
       ↓
Cloudflare Tunnel
       ↓
Traefik / Preview Gateway
       ↓
NestJS Preview Container
       ├─ /docs       Swagger UI
       ├─ /docs-json  OpenAPI document
       └─ /*          Actual API
```

---

## 2. Runtime Detection & Start

### 2.1 프로젝트 감지

다음 신호를 조합해 NestJS를 감지한다.

- `package.json`의 `@nestjs/core` dependency
- `nest-cli.json` 존재
- `start:dev`, `start`, `start:debug` script
- monorepo라면 선택된 app/workspace의 package와 실행 경로

단일 파일만 보고 확정하지 않으며 감지 결과와 선택한 start command를 시작 전에 표시한다. 자동 감지가 모호하면 임의 command를 실행하지 않고 사용자 선택을 요구한다.

### 2.2 실행 계약

- 서버는 container 내부 `0.0.0.0`에 listen해야 한다.
- 실제 listen port를 감지하거나 명시 설정으로 받는다.
- 기본 개발 실행은 프로젝트의 검증된 `start:dev` script를 우선한다.
- shell 문자열 결합 대신 argv 기반 허용된 package-manager command를 사용한다.
- ready 상태는 프로세스 생존만이 아니라 제한 시간 내 HTTP 응답으로 판정한다.
- 시작 실패 시 command, exit status, redacted log와 수정 가능한 원인을 보여준다.
- 기존 Preview의 owner/session, TTL, restart, stop, cleanup 규칙을 동일하게 적용한다.

### 2.3 HTTP readiness 및 실패 진단 구현

- port 감지 뒤 container의 Docker hostname으로 실제 HTTP GET을 보내 외부 network bind 가능 여부까지 확인한다.
- endpoint의 404도 유효한 HTTP 응답이므로 ready로 인정하며 connection 거부와 request timeout만 재시도한다.
- stack trace의 `main.ts:31` 같은 문자열을 port로 오인하지 않도록 log port는 HTTP URL만 해석하고 listening socket과 교차 검증한다.
- 제한 시간 전 process가 종료되면 exit code와 함께 즉시 실패한다.
- 시작 실패는 단계, argv command, process 상태, secret 제거 로그, 원인별 수정 힌트를 Registry와 Telegram 오류에 남긴다.
- readiness 실패 container는 강제 제거하고 container ID를 Registry에서 해제해 route가 발급되지 않게 한다.

---

## 3. OpenAPI / Swagger Discovery

- 우선순위가 있는 후보(`/docs`, `/api`, `/swagger`, `/docs-json` 등)를 제한적으로 probe한다.
- Swagger HTML은 content type과 문서 signature로, OpenAPI JSON은 `openapi`/`swagger` root field로 확인한다.
- source/config에서 경로를 신뢰성 있게 찾을 수 있으면 probe보다 우선할 수 있다.
- 사용자가 프로젝트별 문서 경로와 health path를 override할 수 있다.
- 문서가 없더라도 HTTP API Preview 자체는 실행할 수 있으며 UI에 `문서 미탐지`로 표시한다.
- 문서 자동 생성이 필요하면 별도의 Agent 코드 변경 요청으로 처리하고 Preview Manager가 source를 묵시적으로 수정하지 않는다.

### 3.1 구현 결과

- NestJS `src/main.ts`의 `SwaggerModule.setup()`과 `jsonDocumentUrl`이 직접 문자열이면 우선 후보로 사용한다.
- 정적 탐지 결과도 신뢰만 하지 않고 container hostname에 실제 HTTP GET을 보내 최종 검증한다.
- Swagger UI는 성공 응답의 `text/html` content type과 `swagger-ui`/`SwaggerUIBundle` signature를 함께 확인한다.
- OpenAPI JSON은 성공 응답의 JSON content type과 root `openapi` 또는 `swagger` 문자열 field를 함께 확인한다.
- 응답 body는 probe당 최대 1 MiB만 읽고, 후보는 UI 3개, JSON 5개, health 2개로 제한한다.
- 프로젝트 override가 있으면 해당 종류는 override 경로만 확인한다. 미탐지 경고를 남기되 Preview는 `RUNNING`으로 전환한다.
- 탐지된 UI/JSON/health path는 Registry에 저장하며 restart 때 다시 검증한다.

Telegram UI 예시:

```text
API Preview · my-nest-api
상태: RUNNING
Runtime: NestJS / Port 3000
OpenAPI: /docs-json

[API 문서 열기] [Health 확인]
[로그] [재시작] [종료]
```

### 3.2 Telegram API Preview UI 구현 결과

- Preview 목록에서 Web과 Backend API를 구분하고 Backend API framework를 함께 표시한다.
- Backend API 상세 화면은 framework/port, OpenAPI UI·JSON path, health path, uptime과 실패 원인을 표시한다.
- OpenAPI가 없으면 `문서 미탐지`로 표시하되 `RUNNING` 상태와 API·health·로그·재시작·종료 기능은 유지한다.
- Access와 데이터 격리가 검증된 외부 Preview에만 API root, Swagger UI, OpenAPI JSON, health HTTPS 버튼을 제공한다.
- Access 미검증 상태에서는 탐지된 endpoint path만 상태 정보로 보여주고 hostname과 모든 외부 URL 버튼은 숨긴다.
- API 요청이 dev 데이터를 실제 변경할 수 있다는 경고와 `dev 전용` 데이터 대상을 상세 화면에 명시한다.
- endpoint URL은 동일 HTTPS Preview origin의 안전한 절대 path로만 만든다.

---

## 4. Gateway / HTTP Compatibility

Preview Gateway는 다음을 손실 없이 전달해야 한다.

- HTTP method, path, query string, request/response body
- JSON, form, multipart upload와 streaming response
- `Authorization`, content negotiation 및 필요한 application header
- cookie와 `Set-Cookie`의 host/path 정책
- Swagger UI asset과 OpenAPI schema 요청
- Swagger `Try it out`의 same-origin API 호출

기준:

- 외부 Preview URL과 내부 container URL 차이로 OpenAPI `servers`가 깨지지 않게 한다.
- 필요 시 response 문서 또는 forwarded header를 이용하되 application payload를 무차별 rewrite하지 않는다.
- CORS는 same-origin 구성을 우선하고 wildcard credential 조합을 기본값으로 만들지 않는다.
- WebSocket/SSE를 사용하는 API도 기존 Gateway capability 범위에서 회귀 검증한다.

### 4.1 구현 결과

- Route API가 `runtimeType`과 검증된 `openapiJsonPath`를 Gateway에 전달한다.
- Gateway는 GET/POST/PATCH/DELETE, query string, JSON, form, multipart body와 `Authorization`/`Accept`/`Origin`/cookie 등 application header를 그대로 전달한다.
- 고정 hop-by-hop header뿐 아니라 `Connection`에 열거된 동적 hop-by-hop header도 upstream으로 넘기지 않는다.
- `X-Forwarded-Host`, `X-Forwarded-Proto`, `X-Forwarded-Port`, `X-Forwarded-For`를 일관되게 구성하며 지원하지 않는 proto 값은 외부 기본값인 HTTPS로 제한한다.
- 일반 JSON payload는 rewrite하지 않는다. 탐지된 OpenAPI JSON endpoint의 `servers[].url`과 Swagger v2 `host`/`schemes` 중 container/localhost/public host만 구조적으로 외부 Preview origin으로 보정한다.
- 내부 target으로 향하는 absolute redirect `Location`도 같은 Preview origin으로 바꾼다.
- upstream `Set-Cookie`의 내부 `Domain` 속성을 제거해 Preview hostname의 host-only cookie로 격리하고 기존 `Path`/`Secure`/`HttpOnly`/`SameSite`는 유지한다.
- OpenAPI 문서는 최대 4 MiB까지만 buffering/rewrite하고 초과·비정상 JSON 응답은 credential 우회 노출을 막기 위해 거부한다. 일반 API/SSE 응답은 streaming한다.
- same-origin을 기본으로 두며 Gateway가 wildcard CORS나 credential header를 임의로 추가하지 않는다.
- Gateway 자체 `/health`는 localhost 요청과 `/_agent-hub/health`로 제한해 Preview API의 `/health` endpoint를 가로채지 않는다.
- 기존 Next.js HMR WebSocket과 NestJS SSE를 함께 회귀 검증한다.

---

## 5. Security & Data Isolation

API Preview는 조회 화면이 아니라 실제 데이터 변경 endpoint를 호출할 수 있으므로 Web Preview보다 강한 경계를 적용한다.

- 외부 공개 경로 전체를 Cloudflare Tunnel 뒤에 두고 Cloudflare Access 인증을 필수화한다.
- Oracle Cloud inbound port를 직접 개방하지 않는다.
- Preview는 프로젝트별 개발 DB와 전용 MariaDB 계정만 사용한다.
- 운영 DB hostname/account/secret 주입을 거부하거나 allowlist 정책으로 차단한다.
- R2도 프로젝트별 개발 bucket/credential만 주입한다.
- 선택 프로젝트 루트의 `.env.preview`만 선택적으로 전달하고, 파일이 없으면 환경 변수 없이 실행한다.
- secret은 Telegram, URL, OpenAPI document, log, DB metadata에 노출하지 않는다.
- container network egress와 내부 인프라 접근은 필요한 대상만 허용한다.
- Swagger UI에서 변경 요청이 가능하다는 경고와 현재 연결 대상(dev)을 명시한다.
- Preview URL은 session/project ownership과 TTL을 적용하고 stop/expiry 후 route를 제거한다.

Cloudflare Access가 설정되지 않았거나 개발 데이터 격리를 검증할 수 없으면 외부 URL 발급을 실패 처리한다.

### 5.1 17-6-1 구현 결과

- `PREVIEW_TUNNEL_ONLY`, Access team domain/audience 설정을 확인한 뒤 생성 hostname을 비인증 probe한다. 실제 Access challenge가 확인된 경우에만 `access_verified`를 기록한다.
- `BACKEND_API` route는 `access_verified`가 참일 때만 Gateway에 target을 반환한다. 미검증 상태에서는 runtime 내부 검증은 유지하지만 Telegram의 URL/열기 버튼과 외부 route는 차단한다.
- 설정 누락, probe timeout/오류, 공개 origin의 `200`, 엉뚱한 redirect는 모두 승인하지 않는 fail-closed 정책이다.
- 시작, reconcile, restart 때 Access 상태를 다시 확인한다.

### 5.2 17-6-2 구현 결과

- Backend API Preview는 선택 프로젝트 루트의 `.env.preview`가 있을 때만 읽는다. 비밀값은 Docker 명령 인자에 넣지 않고 Docker CLI의 일시적 프로세스 환경을 통해 선택 container에만 전달한다. 파일이 없으면 실패하지 않고 환경 변수 없이 실행한다.
- MariaDB, MongoDB, Redis, R2 등 서비스 종류와 변수 이름은 프로젝트가 결정하며 Core/Coolify 전역 환경 변수에서 값을 가져오지 않는다.
- 프로젝트와 monorepo install root 아래 `.env`, `.env.*`는 Preview container에서 `/dev/null` read-only mount로 마스킹한다. 선택한 `.env.preview`도 값 주입 후 container 파일 경로는 마스킹하며 symlink는 시작을 거부한다.
- `.env.preview`는 Git ignore 대상이고 값은 Docker 명령 인자, Telegram, URL, OpenAPI document, log에 출력하지 않는다.
- container root filesystem은 read-only로 두고 Linux capability 전체 제거, `no-new-privileges`, PID/CPU/memory 제한, 제한된 tmpfs를 적용한다. workspace만 기존 개발 동작을 위해 write mount로 유지한다.
- 격리 완료 container에 관리 label을 기록하고 reconcile/restart에서도 label과 Cloudflare Access를 함께 확인한다. 기존 또는 미검증 container의 외부 route는 열지 않는다.
- OpenAPI JSON은 URL 보정 전에 실제 secret key/example/connection URL을 재귀 제거한다. 로그 redaction은 quoted env, DB URL, JWT, private key까지 처리한다.

---

## 6. 예상 변경 범위

- Preview runtime type에 `BACKEND_API` 추가
- NestJS detector, package-manager command resolver, readiness probe
- OpenAPI/Swagger/health endpoint discovery 및 project override
- Preview Gateway의 HTTP method/body/header/cookie/streaming 회귀 보강
- Telegram API Preview renderer와 actions
- 프로젝트별 `.env.preview` 선택 로더와 secret 격리
- Cloudflare Access readiness/config validation
- NestJS fixture와 실제 개발 DB를 분리한 E2E 환경

구체적인 schema와 파일명은 착수 시 현재 Preview Manager 구현을 기준으로 확정한다.

---

## 7. NestJS 테스트 Fixture와 공동 검증 절차

현재 별도 NestJS 프로젝트가 없으므로 Phase 17 착수 시 테스트 전용 프로젝트를 기본 NestJS 프로젝트에서 만든다. 전역 Nest CLI 설치나 기존 서비스 프로젝트를 전제하지 않는다. 생성 시점의 Node.js, NestJS, package manager 버전과 lockfile을 fixture에 고정해 이후 테스트 결과가 달라지지 않게 한다.

### 7.1 Fixture 구성

최종 자동 테스트에는 다음 두 fixture를 독립적으로 둔다.

```text
tests/fixtures/
├─ nest-no-openapi/   # @nestjs/swagger 패키지와 문서 설정이 전혀 없음
└─ nest-openapi/      # Swagger UI와 OpenAPI JSON을 명시적으로 제공
```

두 fixture 모두 기본 NestJS 프로젝트에서 시작하고 다음 최소 endpoint를 동일하게 제공한다.

- `GET /health`: readiness 및 health 확인
- `GET /items`: 목록 조회
- `POST /items`: JSON body 생성
- `PATCH /items/:id`: 일부 수정
- `DELETE /items/:id`: 삭제
- `POST /upload`: multipart 전달 확인
- `GET /events`: 가능하면 SSE 회귀 확인

초기 CRUD는 메모리 저장소를 사용한다. Preview runtime과 Gateway가 안정된 뒤 개발 서버의 Phase 17 전용 MariaDB DB/계정을 연결하는 통합 시나리오를 별도로 추가한다. 기본 fixture에 운영 credential이나 개인 개발 DB credential을 커밋하지 않는다.

`nest-no-openapi`에는 `@nestjs/swagger`를 설치하지 않는다. `nest-openapi`는 전자를 복제한 뒤 Swagger 패키지와 bootstrap 설정만 추가한다. 환경 변수 하나로 Swagger를 끄는 방식만 사용하면 패키지가 이미 존재하는 상태만 검증하게 되므로, 두 프로젝트를 분리해 진짜 미설치 상태도 보장한다.

### 7.2 우리가 같이 진행할 순서

1. 내가 기본 NestJS fixture를 생성하고 endpoint, bind address, 고정 버전, 실행 명령을 준비한다.
2. 먼저 Swagger 패키지가 없는 `nest-no-openapi`를 Agent Hub에서 선택한다.
3. 너는 Telegram에서 Preview 시작·health·로그·재시작·종료를 실행하고, 나는 서버에서 runtime 상태, 로그, HTTP 요청과 cleanup을 확인한다.
4. 이 상태에서 `문서 미탐지`가 표시되지만 Preview 전체는 `RUNNING`인지 확인한다.
5. 같은 기본 프로젝트를 복제해 `nest-openapi`를 만들고 Swagger UI(`/docs`)와 OpenAPI JSON(`/docs-json`)을 추가한다.
6. 다시 Preview를 시작해 자동 탐지, 외부 문서 URL, Cloudflare Access, Swagger `Try it out`을 확인한다.
7. 두 fixture를 번갈아 재실행해 이전 탐지 결과가 session/project 사이에 남지 않는지 확인한다.
8. 마지막으로 잘못된 문서 경로, custom 문서 경로, 시작 실패, readiness timeout, 포트 충돌을 하나씩 주입해 실패 처리를 확인한다.

각 단계는 자동 테스트 결과와 함께 Telegram 화면, 외부 HTTP status, redacted runtime log를 검증 증거로 남긴다. 수동 확인에만 의존하지 않으며 재현된 동작은 바로 integration/E2E test로 고정한다.

`/preview start`는 절대경로가 아니라 `/home/dev/workspace` 아래 Git repository 이름으로 호출하는 것을 기준으로 유지한다. 수동 검증용 샘플 앱도 같은 root 아래 독립 repo로 두고, 자동 테스트만 저장소 내부 fixture를 임시 workspace로 복사해 사용한다.

### 7.3 핵심 시나리오 판정표

| 시나리오 | Preview 상태 | OpenAPI capability | 필수 확인 |
|---|---|---|---|
| Swagger 패키지/설정 없음 | `RUNNING` | 비활성, `문서 미탐지` | 일반 API, health, 로그, 재시작, 종료 |
| Swagger UI와 JSON 있음 | `RUNNING` | 활성 | `/docs`, `/docs-json`, `Try it out`, 일반 API |
| Swagger 패키지만 있고 bootstrap 안 함 | `RUNNING` | 비활성 | dependency 존재만으로 오탐하지 않음 |
| 잘못된 문서 경로 override | `RUNNING` | 비활성 + 경고 | Preview runtime은 유지 |
| custom 경로(`/internal/docs`) | `RUNNING` | 활성 | override 경로로 UI/JSON 접근 |
| HTTP readiness 실패 | `FAILED` | 판정 안 함 | timeout 원인과 redacted log 표시, route 미발급 |
| Cloudflare Access 미설정 | 내부 검증만 가능 | 탐지 결과 유지 | 외부 URL 발급 차단 |

핵심 판정은 다음과 같다.

```text
Swagger 있음 -> API Preview 성공 + OPENAPI capability 활성
Swagger 없음 -> API Preview 성공 + OPENAPI capability만 비활성
```

### 7.4 17-8 자동 E2E와 재시작 복구 구현 결과

- Docker daemon을 사용할 수 있는 테스트 환경에서는 `nest-openapi`와 `nest-no-openapi`를 임시 workspace에 복사하고 실제 `npm ci` + `start:dev` container로 자동 실행한다. Docker가 없는 환경만 명시적으로 skip한다.
- Swagger fixture는 `/docs`, `/docs-json`, `/health`와 route 활성화를 확인하고, 미설치 fixture는 OpenAPI path 없이 `/health`만 탐지된 `RUNNING` 상태를 확인한다.
- 재시작은 고정 port를 다시 찾고 HTTP readiness, Cloudflare Access, OpenAPI/health endpoint를 모두 다시 검증한다.
- Core가 `STARTING` 상태를 남기고 재기동된 상황도 살아 있는 container의 port/readiness/endpoint를 재구성한 뒤 `RUNNING`으로 복구한다. HTTP 재검증에 실패하면 route를 유지하지 않고 `FAILED` 처리한다.
- 수동 종료와 idle 만료 뒤에는 Registry 상태가 각각 `STOPPED`, `EXPIRED`가 되고 route가 즉시 비활성화되며 관리 container가 남지 않는지 확인한다.
- E2E orphan 검색은 해당 테스트가 만든 container ID로 범위를 제한해 실행 중인 실제 Preview를 건드리지 않는다.

### 7.5 17-9 MariaDB 검증 구현 결과와 실서버 게이트

- `nest-openapi`는 기본 메모리 저장소를 유지하고, allowlist로 검증된 `DATABASE_URL`이 있을 때만 MariaDB의 Phase 17 전용 테이블을 사용한다.
- Docker E2E는 임시 MariaDB DB/계정/암호를 매 실행 생성하고 Preview network 안에서만 연결한다. CRUD의 DB 직접 반영, Preview 재시작 후 영속성, OpenAPI/health 유지, 로그 secret 미노출, 종료 cleanup을 자동 검증한다.
- 운영/개발 credential은 fixture, test source, log에 저장하지 않는다. 테스트가 만든 MariaDB와 Preview container는 성공/실패와 관계없이 제거한다.
- 실제 서버 완료 판정은 `tests/e2e/phase17-live.test.js`의 명시적 evidence gate를 사용한다. Telegram UI, Cloudflare Access, 외부 Swagger, 인증된 CRUD, 개발 MariaDB 반영, 로그, 재시작, cleanup, 기존 Web Preview 회귀를 모두 직접 확인하기 전에는 Phase 17을 `DONE`으로 바꾸지 않는다.

---

## 8. Acceptance / E2E

- [x] NestJS 프로젝트를 감지하고 올바른 workspace에서 `start:dev`로 실행한다.
- [x] 서버가 `0.0.0.0`에 bind되고 HTTP readiness 이후에만 `RUNNING`이 된다.
- [x] Swagger UI와 OpenAPI JSON endpoint를 탐지해 Telegram에서 연다.
- [x] 문서가 없는 API도 OpenAPI capability 없이 `RUNNING` 상태를 유지하고 health를 별도 탐지한다.
- [x] Swagger 패키지가 설치되지 않은 fixture와 설치됐지만 bootstrap되지 않은 경우 모두 문서 미탐지로 처리한다.
- [x] 잘못된 Swagger 경로는 Preview를 중단하지 않고 custom 경로 override는 정상 탐지한다.
- [x] GET/POST/PATCH/DELETE, query, JSON body, multipart 및 Authorization header가 정상 프록시된다.
- [x] Swagger `Try it out` 대상이 동일 Preview origin의 실제 API가 되도록 OpenAPI v2/v3 문서를 제한적으로 보정한다.
- [x] cookie, same-origin CORS 정책, forwarded host/proto와 OpenAPI server URL이 외부 URL 기준으로 정상 동작한다.
- [x] 로그·오류·문서에 credential과 DB connection secret이 노출되지 않는다.
- [x] 운영 DB/R2 credential 또는 금지된 내부 target 연결 시 시작이 차단된다.
- [x] Cloudflare Access가 없는 외부 API Preview URL은 발급되지 않는다.
- [x] Preview 종료·만료·Core 재시작 시 process/container/route cleanup이 일관된다.
- [x] 기존 Next.js/Vite/Mobile Preview E2E가 회귀하지 않는다.

---

## 9. 완료 조건

NestJS fixture 자동 테스트와 실제 개발 환경에서 다음 흐름을 통과해야 `DONE` 처리한다.

```text
NestJS 프로젝트 선택
-> API Preview 시작
-> Cloudflare Access 인증
-> Swagger UI/OpenAPI 확인
-> 인증된 CRUD 요청 실행
-> 개발 MariaDB 반영 확인
-> 로그/health/restart 확인
-> 종료 후 route와 runtime 정리 확인
```
