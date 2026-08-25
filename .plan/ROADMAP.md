# Agent Hub V1 Implementation Roadmap

> **Status:** Implementation Baseline\
> **Source of Truth:** `.plan/PROJECT_PLAN.md`\
> **Execution Rule:** 반드시 Phase 단위로 구현 → 검증 → 커밋 → 상태 갱신
> → 다음 Phase 순서로 진행한다.

이 문서는 `PROJECT_PLAN.md`에 정의된 Agent Hub V1 아키텍처를 실제 개발
가능한 12단계(Phase 0 \~ Phase 11)로 분할한 실행 로드맵이다.

## 1. 단계별 요약 및 상태

| 마일스톤 | 대상 Phase | 단계명 | 핵심 검증 목표 | 상세 파일 | 상태 |
|---|---|---|---|---|---|
| **Deploy #1** | **Phase 0 + 1** | Baseline & Core Persistence | 컨테이너 기동, Telegram 인증, SQLite 영속화, 세션 CRUD | [PHASE_00](file:///c:/dev/workspace/agent-hub-core/.plan/PHASE_00_BASELINE_AUDIT.md), [PHASE_01](file:///c:/dev/workspace/agent-hub-core/.plan/PHASE_01_CORE_PERSISTENCE.md) | `TESTED_OK` |
| **Deploy #2** | **Phase 2 + 3** | Provider Abstraction & Job Queue | 동적 모델 검색, `/model`, 세션/동시성 큐, `/stop`, 재시작 복구 | [PHASE_02](file:///c:/dev/workspace/agent-hub-core/.plan/PHASE_02_PROVIDER_ABSTRACTION.md), [PHASE_03](file:///c:/dev/workspace/agent-hub-core/.plan/PHASE_03_JOB_RUNTIME.md) | `TESTED_OK` |
| **Deploy #3** | **Phase 4 + 5** | Multi-Provider & Context Handoff | Antigravity CLI(agy) 통합, Codex ↔ Antigravity Handoff, 증분 복귀, `/compact` | [PHASE_04](file:///c:/dev/workspace/agent-hub-core/.plan/PHASE_04_CONTEXT_HANDOFF.md), [PHASE_05](file:///c:/dev/workspace/agent-hub-core/.plan/PHASE_05_ANTIGRAVITY_INTEGRATION.md) | `READY_FOR_TEST` |

  ------------------------------------------------------------------------------------------------------------------------
  Phase          단계명             핵심 내용                          상세 파일                            상태
  -------------- ------------------ ---------------------------------- ------------------------------------ --------------
  **Phase 0**    Baseline Audit &   기존 코드 감사, Codex CLI 버전     `PHASE_00_BASELINE_AUDIT.md`         `DONE`
                 Environment        고정, `/data` 영속 구조,                                                
                                    Capability Audit                                                        

  **Phase 1**    Core Persistence & SQLite, 안전 Migration,            `PHASE_01_CORE_PERSISTENCE.md`       `DONE`
                 Session            세션/메시지, `/new`, `/sessions`,                                       
                                    `/rename`, Archive/Restore                                              

  **Phase 2**    Provider           ProviderAdapter, CodexAdapter,     `PHASE_02_PROVIDER_ABSTRACTION.md`   `DONE`
                 Abstraction &      Capability 기반 동적 모델 조회,                                         
                 Model Discovery    `/model`, `/providers`, 자동 제목                                       

  **Phase 3**    Job Runtime &      Job 상태 머신, Session/Provider    `PHASE_03_JOB_RUNTIME.md`            `DONE`
                 Queue              Queue, `/queue`, `/stop`, Response                                      
                                    Renderer                                                                

  **Phase 4**    Context Management Canonical Context, Native Context, `PHASE_04_CONTEXT_HANDOFF.md`        `DONE`
                 & Handoff          Rolling Summary, `/compact`,                                            
                                    Transactional Handoff                                                   

  **Phase 5**    Antigravity        Antigravity CLI (agy) 설치,        `PHASE_05_ANTIGRAVITY_INTEGRATION.md` `DONE`
                 Integration        AntigravityAdapter, Codex ↔                                             
                                    Antigravity Handoff                                                     

  **Phase 6**    Multi-Attachment   다중 이미지/파일, Telegram Media   `PHASE_06_ATTACHMENTS.md`            `PLANNED`
                                    Group, `/data/uploads`, Provider                                        
                                    연동                                                                    

  **Phase 7**    Global Memory      Markdown 장기 기억, Audit Trail,   `PHASE_07_GLOBAL_MEMORY.md`          `PLANNED`
                                    `/memory`, Context/Scheduler 주입                                       

  **Phase 8**    Internal Scheduler OS cron 배제, 자연어 등록+확인,    `PHASE_08_SCHEDULER.md`              `PLANNED`
                                    독립 Job, 결과 전체 저장,                                               
                                    SKIP/Timeout                                                            

  **Phase 9**    Infrastructure     SSH Registry, 실제 `~/.ssh` 연동,  `PHASE_09_INFRASTRUCTURE.md`         `PLANNED`
                                    Docker Socket + Docker CLI,                                             
                                    Execution Profile                                                       

  **Phase 10**   Operations &       `/usage`, `/status`, `/settings`,  `PHASE_10_OPERATIONS_BACKUP.md`      `PLANNED`
                 Backup             내부 `/health`, Core/Full Backup,                                       
                                    Notification, Cleanup                                                   

  **Phase 11**   Hardening & V1     장애/재시작/동시성/복구/E2E/백업   `PHASE_11_HARDENING_RELEASE.md`      `PLANNED`
                 Release            복원 검증, V1 릴리즈                                                    
  ------------------------------------------------------------------------------------------------------------------------

## 2. Phase 실행 규칙

각 Phase는 다음 순서를 지킨다.

1.  해당 Phase MD와 `PROJECT_PLAN.md`를 먼저 읽는다.
2.  현재 코드와 계획이 충돌하면 임의 구현하지 말고 충돌을 기록한다.
3.  해당 Phase 범위만 구현한다.
4.  Phase에 명시된 Unit/Integration Test를 작성하고 실행한다.
5.  기존 완료 Phase의 회귀 테스트도 실행한다.
6.  애플리케이션 Build/Startup을 확인한다.
7.  검증 기준을 모두 만족해야 Phase를 `DONE`으로 변경한다.
8.  `PROJECT_PLAN.md` 및 관련 Phase 문서를 실제 구현과 동기화한다.
9.  Git Commit 후 다음 Phase로 이동한다.

## 3. 절대 준수 원칙

1.  토큰/API Key/OAuth Credential/SSH Private Key 등 비밀값을 로그에
    남기지 않는다.
2.  SSH 개인키 내용은 SQLite에 저장하지 않는다.
3.  Provider 모델 목록을 하드코딩하지 않는다. CLI가 신뢰 가능한
    Discovery를 제공하지 않으면 `UNSUPPORTED`로 처리한다.
4.  존재하지 않는 Usage/Token/Context 수치를 추정하지 않는다.
    `NULL/UNKNOWN`을 유지한다.
5.  Provider Handoff가 성공하기 전에 `active_provider`를 변경하지
    않는다.
6.  Native Compact 때문에 Canonical Message를 삭제하지 않는다.
7.  Provider 기능이 없을 때 다른 기능을 같은 기능인 것처럼 자동
    Fallback하지 않는다.
8.  Migration 실패 상태에서 애플리케이션을 계속 기동하지 않는다.
9.  각 Phase 완료 후 전체 애플리케이션은 Build/Startup 가능한 상태여야
    한다.
10. Phase 11에 테스트를 몰지 않는다. 각 Phase에서 해당 기능 테스트를
    함께 작성한다.
11. `/data`는 영속 상태이며 컨테이너는 Disposable이어야 한다.
12. V1 범위를 임의로 확장하지 않는다. 신규 아이디어는 Backlog로 보낸다.

## 4. Capability-First 원칙

Codex/Gemini CLI 동작은 추측하지 않는다. 설치된 **고정 버전**에서 실제
명령과 출력을 검증한다.

특히 다음은 Capability Audit 대상이다.

-   Auth persistence
-   Non-interactive execution
-   Native session create/resume
-   Same-provider model switching
-   Model discovery
-   Usage/quota
-   Context metrics
-   Native compact
-   Attachment/image support
-   Machine-readable output
-   Cancellation
-   Sandbox/approval mapping

## 5. V1 완료 조건

Phase 0 \~ 10이 `DONE`이고 Phase 11의 실제 E2E/복구 리허설까지
통과해야만 V1 완료로 간주한다.
