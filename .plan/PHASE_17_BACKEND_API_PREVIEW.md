# Phase 17: Backend HTTP Preview & OpenAPI Discovery

## Status

`PLANNED`

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

---

## 3. OpenAPI / Swagger Discovery

- 우선순위가 있는 후보(`/docs`, `/api`, `/swagger`, `/docs-json` 등)를 제한적으로 probe한다.
- Swagger HTML은 content type과 문서 signature로, OpenAPI JSON은 `openapi`/`swagger` root field로 확인한다.
- source/config에서 경로를 신뢰성 있게 찾을 수 있으면 probe보다 우선할 수 있다.
- 사용자가 프로젝트별 문서 경로와 health path를 override할 수 있다.
- 문서가 없더라도 HTTP API Preview 자체는 실행할 수 있으며 UI에 `문서 미탐지`로 표시한다.
- 문서 자동 생성이 필요하면 별도의 Agent 코드 변경 요청으로 처리하고 Preview Manager가 source를 묵시적으로 수정하지 않는다.

Telegram UI 예시:

```text
API Preview · my-nest-api
상태: RUNNING
Runtime: NestJS / Port 3000
OpenAPI: /docs-json

[API 문서 열기] [Health 확인]
[로그] [재시작] [종료]
```

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

---

## 5. Security & Data Isolation

API Preview는 조회 화면이 아니라 실제 데이터 변경 endpoint를 호출할 수 있으므로 Web Preview보다 강한 경계를 적용한다.

- 외부 공개 경로 전체를 Cloudflare Tunnel 뒤에 두고 Cloudflare Access 인증을 필수화한다.
- Oracle Cloud inbound port를 직접 개방하지 않는다.
- Preview는 프로젝트별 개발 DB와 전용 MariaDB 계정만 사용한다.
- 운영 DB hostname/account/secret 주입을 거부하거나 allowlist 정책으로 차단한다.
- R2도 프로젝트별 개발 bucket/credential만 주입한다.
- `.env` 전체 자동 전달을 금지하고 Preview용 secret allowlist를 사용한다.
- secret은 Telegram, URL, OpenAPI document, log, DB metadata에 노출하지 않는다.
- container network egress와 내부 인프라 접근은 필요한 대상만 허용한다.
- Swagger UI에서 변경 요청이 가능하다는 경고와 현재 연결 대상(dev)을 명시한다.
- Preview URL은 session/project ownership과 TTL을 적용하고 stop/expiry 후 route를 제거한다.

Cloudflare Access가 설정되지 않았거나 개발 데이터 격리를 검증할 수 없으면 외부 URL 발급을 실패 처리한다.

---

## 6. 예상 변경 범위

- Preview runtime type에 `BACKEND_API` 추가
- NestJS detector, package-manager command resolver, readiness probe
- OpenAPI/Swagger/health endpoint discovery 및 project override
- Preview Gateway의 HTTP method/body/header/cookie/streaming 회귀 보강
- Telegram API Preview renderer와 actions
- Preview env/secret allowlist 및 production target guard
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

---

## 8. Acceptance / E2E

- [ ] NestJS 프로젝트를 감지하고 올바른 workspace에서 `start:dev`로 실행한다.
- [ ] 서버가 `0.0.0.0`에 bind되고 HTTP readiness 이후에만 `RUNNING`이 된다.
- [ ] Swagger UI와 OpenAPI JSON endpoint를 탐지해 Telegram에서 연다.
- [ ] 문서가 없는 API도 `문서 미탐지` 상태로 실행·health·로그 관리가 가능하다.
- [ ] Swagger 패키지가 설치되지 않은 fixture와 설치됐지만 bootstrap되지 않은 경우 모두 문서 미탐지로 처리한다.
- [ ] 잘못된 Swagger 경로는 Preview를 중단하지 않고 custom 경로 override는 정상 탐지한다.
- [ ] GET/POST/PATCH/DELETE, query, JSON body, multipart 및 Authorization header가 정상 프록시된다.
- [ ] Swagger `Try it out`이 동일 Preview host의 실제 API를 호출한다.
- [ ] cookie, CORS, forwarded host/proto와 OpenAPI server URL이 외부 URL에서 정상 동작한다.
- [ ] 로그·오류·문서에 credential과 DB connection secret이 노출되지 않는다.
- [ ] 운영 DB/R2 credential 또는 금지된 내부 target 연결 시 시작이 차단된다.
- [ ] Cloudflare Access가 없는 외부 API Preview URL은 발급되지 않는다.
- [ ] Preview 종료·만료·Core 재시작 시 process/container/route cleanup이 일관된다.
- [ ] 기존 Next.js/Vite/Mobile Preview E2E가 회귀하지 않는다.

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
