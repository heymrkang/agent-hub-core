# Phase 20: Deploy Webhooks, Voice Prompting & Smart Quota

## Status

`PLANNED`

## 1. 목표

Phase 19는 Telegram 모바일 환경에서 개발자의 인터랙션과 운영 효율을 극대화하기 위해 다음 3대 핵심 기능을 구현한다.

1. **Coolify 배포 연동 (`/deploy`)**: 텔레그램에서 Coolify 배포 Webhook을 즉시 트리거하고 빌드/배포 상태를 실시간 알림으로 수신.
2. **Telegram Voice Note to Prompt (Whisper STT)**: 텔레그램 음성 녹음 메시지를 개발 전문 용어 보정 STT를 통해 텍스트 프롬프트로 변환하여 작업 큐에 인입.
3. **부하 0% Smart Quota & Token Alerting**: 별도 폴링/배치 없이 Job 완료 시점(Post-Job Hook)에서 토큰 사용량을 누적하고 일일 임계치(80%, 95%) 돌파 시 자동 경고.

---

## 2. 세부 설계 및 기능 명세

### 2.1 Coolify Deploy Integration (`/deploy` & Webhook Notification)

#### 2.1.1 배포 트리거 (`/deploy`)
- **명령어**:
  - `/deploy`: 등록된 배포 대상 애플리케이션 인라인 키보드 버튼 표시.
  - `/deploy <app-alias>`: 지정된 애플리케이션 즉시 배포 트리거.
- **동작**:
  - 설정/DB(`settings` 또는 `deploy_targets`)에 저장된 Coolify Deploy Webhook URL로 `POST` 요청 1회 발송.
  - 요청 직후 Telegram에 `🚀 [<app>] 배포 요청을 전송했습니다.` 즉각 피드백.

#### 2.1.2 배포 상태 수신 Webhook (`POST /api/webhooks/coolify`)
- **엔드포인트**: Agent Hub HTTP 서버에 Coolify 전용 Webhook 리스너 개설.
- **수신 이벤트 및 알림**:
  - **배포 성공**: `✅ [<app>] 배포 성공! (소요 시간: MM분 SS초, Commit: <sha>)`
  - **배포 실패**: `❌ [<app>] 배포 실패!` + 실패 로그 요약(마지막 5줄) 텔레그램 푸시.

---

### 2.2 Telegram Voice Note to Prompt (Whisper STT Integration)

#### 2.2.1 음성 메시지 핸들러 (`src/telegram/handlers/voice.js`)
- `ctx.message.voice` 및 `ctx.message.audio` 이벤트 리스너 등록.
- Telegram Bot API `getFile`을 통해 `.oga` / `.ogg` 음성 파일 다운로드 (메모리 버퍼 처리).

#### 2.2.2 음성 텍스트 변환 (`src/utils/stt.js`)
- OpenAI Whisper API (`v1/audio/transcriptions`) 연동.
- **프롬프트 힌트**: `prompt: "React, Node.js, Next.js, API, Docker, PR, Git, Controller, Service, 버그, 리팩토링, 배포, 핫픽스"` 파라미터 전달로 개발 전문 용어 인식 정확도 극대화.
- 변환 완료 시 Telegram에 `🎙️ 음성 인식: "<변환된 텍스트>"` 확인 메시지 1줄 전송.
- 일반 텍스트 입력과 동일하게 `JobQueue.enqueueJob()` 파이프라인으로 자연스럽게 인입.

---

### 2.3 부하 0% Smart Quota & Token Alerting

#### 2.3.1 Post-Job Hook 기반 누적 (`src/jobs/job-runner.js`)
- Background polling이나 별도 스케줄러 배치 호출 없이, **Job이 완료되는 순간에만 실행 (오버헤드 0.0001초)**.
- AI Provider 응답 메타데이터의 `usage.total_tokens` 값을 추출.
- SQLite DB `daily_quota_usage` 테이블에 오늘 날짜(UTC/KST) 기준으로 누적:
  ```sql
  INSERT INTO daily_quota_usage (date, used_tokens, alert_80_sent, alert_95_sent)
  VALUES (CURRENT_DATE, :tokens, 0, 0)
  ON CONFLICT(date) DO UPDATE SET used_tokens = used_tokens + :tokens;
  ```

#### 2.3.2 Threshold Alerting
- 일일 할당량(Default: 200,000 tokens, `/settings`로 변경 가능) 대비 현재 누적치 비교:
  - **80% 초과 & `alert_80_sent = 0`**: `⚠️ [Quota 경고] 오늘 토큰 사용량이 80%를 초과했습니다. (<used> / <limit>)` 알림 발송 후 플래그 업데이트.
  - **95% 초과 & `alert_95_sent = 0`**: `🚨 [Quota 위험] 일일 한도에 근접했습니다! (<used> / <limit>)` 알림 발송.
- 날짜가 바뀌면(자정) 신규 레코드가 생성되어 플래그가 자동 리셋됨.

---

## 3. 구현 대상 파일 목록

```text
agent-hub-core/
├── .plan/
│   ├── PHASE_19_DEPLOY_VOICE_QUOTA.md
│   └── ROADMAP.md
├── src/
│   ├── telegram/
│   │   ├── commands/
│   │   │   └── deploy.js               [NEW]
│   │   └── handlers/
│   │       └── voice.js                [NEW]
│   ├── webhooks/
│   │   └── coolify.js                  [NEW]
│   ├── utils/
│   │   └── stt.js                      [NEW]
│   ├── quota/
│   │   └── quota-service.js            [NEW]
│   └── database/
│       └── migrations/
│           └── 016_add_deploy_and_quota.sql [NEW]
```

---

## 4. Acceptance Criteria

- [ ] `/deploy <app>` 명령어로 Coolify Webhook이 0.5초 이내에 성공적으로 호출된다.
- [ ] Coolify 배포 완료 Webhook을 Agent Hub가 정상 수신하여 텔레그램 메시지로 변환·푸시한다.
- [ ] 텔레그램 음성 메시지가 Whisper API를 통해 한글/개발용어로 정밀 변환되어 작업으로 실행된다.
- [ ] Job 완료 시 Post-Job Hook을 통해 토큰 사용량이 누적되고, 80%/95% 도달 시 알림이 1회씩만 발송된다.
- [ ] 전체 기능이 백그라운드 폴링 없이 이벤트 기반으로 동작하여 시스템 부하가 발생하지 않는다.
