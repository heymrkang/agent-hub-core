# NestJS Backend Preview fixtures

Phase 17에서 Backend API Preview를 검증하는 독립 실행형 프로젝트다.

- `nest-no-openapi`: Swagger dependency와 bootstrap 설정이 모두 없다.
- `nest-openapi`: Swagger UI `/docs`와 OpenAPI JSON `/docs-json`을 제공한다.

두 fixture는 Node.js `20.20.2`, npm `10.8.2`, NestJS `11.2.3`을 기준으로 고정했다. 기본 CRUD는 프로세스별 메모리 저장소라 DB나 외부 secret을 요구하지 않는다.

`nest-openapi`에 검증된 `DATABASE_URL`을 allowlist로 주입하면 동일 CRUD가 `phase17_preview_items` 테이블을 사용한다. 이 선택 경로는 Phase 17 MariaDB E2E 전용이며 URL이나 credential은 fixture에 저장하지 않는다.

각 디렉터리에서 다음 명령으로 검증한다.

```sh
npm ci --include=dev
npm test
```

서버만 실행할 때는 `npm run start:dev`를 사용한다. `PORT` 기본값은 `3000`이고 서버는 `0.0.0.0`에 bind한다.
