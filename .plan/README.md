# Agent Hub Planning Index

`.plan` 루트에는 현재 기준, post-V1 완료 기록과 미착수 계획을 둔다. V1 완료·대체 계획과 감사 기록은 `archive/v1`에서 보존한다.

## 현재 기준

- `PROJECT_PLAN.md`: 현행 아키텍처, 불변 원칙, 작업 규칙
- `ROADMAP.md`: 완료 상태와 다음 Phase 순서
- `CAPABILITIES_CODEX.md`: 고정 Codex CLI capability baseline
- `CAPABILITIES_ANTIGRAVITY.md`: 고정 Antigravity CLI capability baseline

## Post-V1 Phase

- `PHASE_13_PREVIEW_MANAGER.md`: `DONE` — Mobile Preview Runtime & Preview Manager
- `PHASE_14_SYSTEM_RESOURCES.md`: 다음 구현 Phase
- `PHASE_16_STABILITY_OPTIMIZATION.md`: `PLANNED` — Canonical Compact, Thinking 설정, Provider Usage/Quota
- `PHASE_17_BACKEND_API_PREVIEW.md`: `PLANNED` — NestJS/OpenAPI Backend API Preview & Inspector
- `PHASE_18_MCP_SKILLS.md`: `PLANNED` — Codex/Antigravity MCP & Skills 조회·관리·권한

## 보관 문서

- `archive/v1/`: Phase 0~11 완료 기록, Phase 12 스킵 결정, 당시 audit 및 대체된 초안

## 문서 관리 규칙

1. 합의된 아키텍처나 운영 불변 조건이 바뀔 때만 `PROJECT_PLAN.md`를 수정한다.
2. Phase 상태나 실행 순서가 바뀌면 `ROADMAP.md`를 수정한다.
3. 진행 중인 Phase의 상세 설계와 체크리스트는 해당 Phase 문서 한 곳에서 관리한다.
4. 완료된 Phase 문서는 `archive`로 이동하고 이후 사실관계 보존용 기록으로 취급한다.
5. Provider CLI를 갱신하면 해당 capability baseline과 regression 결과를 함께 갱신한다.
6. 같은 내용을 여러 문서에 복제하지 않고 canonical 문서를 링크한다.
