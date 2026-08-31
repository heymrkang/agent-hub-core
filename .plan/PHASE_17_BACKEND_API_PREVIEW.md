# Phase 17: Backend API Preview & Inspector

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

## 7. Acceptance / E2E

- [ ] NestJS 프로젝트를 감지하고 올바른 workspace에서 `start:dev`로 실행한다.
- [ ] 서버가 `0.0.0.0`에 bind되고 HTTP readiness 이후에만 `RUNNING`이 된다.
- [ ] Swagger UI와 OpenAPI JSON endpoint를 탐지해 Telegram에서 연다.
- [ ] 문서가 없는 API도 `문서 미탐지` 상태로 실행·health·로그 관리가 가능하다.
- [ ] GET/POST/PATCH/DELETE, query, JSON body, multipart 및 Authorization header가 정상 프록시된다.
- [ ] Swagger `Try it out`이 동일 Preview host의 실제 API를 호출한다.
- [ ] cookie, CORS, forwarded host/proto와 OpenAPI server URL이 외부 URL에서 정상 동작한다.
- [ ] 로그·오류·문서에 credential과 DB connection secret이 노출되지 않는다.
- [ ] 운영 DB/R2 credential 또는 금지된 내부 target 연결 시 시작이 차단된다.
- [ ] Cloudflare Access가 없는 외부 API Preview URL은 발급되지 않는다.
- [ ] Preview 종료·만료·Core 재시작 시 process/container/route cleanup이 일관된다.
- [ ] 기존 Next.js/Vite/Mobile Preview E2E가 회귀하지 않는다.

---

## 8. 완료 조건

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
