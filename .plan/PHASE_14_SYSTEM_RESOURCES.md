# Phase 14: System & Resource Observability

## Status

`DONE`

## 1. 목표

Phase 14는 `/server` Registry에 등록된 모든 활성 서버의 시스템 리소스를 Telegram에서 안전하게 관찰하고 진단하는 기능을 구축한다.

대표 명령은 `/system`이다.

기존 `/status`와 역할을 명확히 분리한다.

- `/status`: Agent Hub 기능/통합이 정상인가?
- `/system`: 등록 서버 전체의 CPU/RAM/Disk/OS/Docker 리소스가 어떤 상태인가?
- `/system <alias>`: 특정 등록 서버의 상세 리소스

Phase 14는 관찰/진단 중심이며 자동 삭제, 자동 restart, kill, prune 같은 destructive self-healing은 범위에서 제외한다.

---

## 2. System Collector

수집 대상은 코드에 고정하지 않고 `/server` Registry의 활성 서버 목록을 사용한다. 서버 추가·제거·활성 상태 변경은 다음 `/system` 조회에 즉시 반영한다. SSH read-only 명령으로 병렬 수집하며, 한 서버의 접속 실패는 `OFFLINE / UNKNOWN`으로 격리한다.

Telegram UI와 분리된 reusable collector/service를 만든다.

수집 실패는 항목별로 격리하며 한 metric 실패로 `/system` 전체가 실패하지 않는다.

### 2.1 Host

- Hostname
- OS / distribution
- Kernel
- Architecture
- Host uptime
- Agent Hub container uptime과 Host uptime을 혼동하지 않는다.

### 2.2 CPU

- Logical CPU/core count
- Current CPU usage %
- Load Average 1m / 5m / 15m
- Load 값과 CPU usage %를 같은 지표처럼 표현하지 않는다.

### 2.3 Memory

- Total
- Used
- Available
- Usage %
- 가능하면 Swap total/used
- Container memory와 Host memory를 구분한다.

### 2.4 Disk

최소 다음 persistent/critical filesystem의 capacity를 확인한다.

- Host root 또는 실제 Agent Hub data가 위치한 host filesystem
- `/data`
- `/home/dev`

표시:

- Total
- Used
- Available
- Usage %

동일 underlying filesystem을 여러 mount가 가리키는 경우 UI에서 불필요한 중복을 줄인다.

### 2.5 Docker

등록 서버에서 Docker 설치 여부와 daemon 상태를 read-only로 확인한다. Docker 미설치는 장애가 아니라 `N/A`로 표시한다.

- Docker daemon version/state
- Running container count
- Stopped/exited container count
- 가능하면 unhealthy/restarting container count
- Agent Hub container 자체의 상태/리소스 식별

`/system`에서 전체 container log dump나 destructive control은 하지 않는다.

### 2.6 Agent Hub Process / Container

- Core process uptime
- Agent Hub container CPU usage
- Agent Hub container memory usage/limit
- 가능하면 container restart count

Host metric과 Agent Hub container metric을 별도 section으로 표시한다.

---

## 3. `/system` Telegram UI

Root는 등록된 전체 서버의 상태를 빠르게 볼 수 있는 overview로 유지한다. 서버 버튼 또는 `/system <alias>`로 상세 화면에 진입한다.

상세 정보가 많아지면 다음과 같은 submenu를 사용한다.

```text
[ CPU / Memory ]
[ Storage ]
[ Docker ]
[ Runtime ]
[ 새로고침 ]
```

Telegram message 길이와 button 난잡함을 피한다.

---

## 4. Resource Warning

상태:

- `OK`
- `WARN`
- `CRITICAL`
- `UNKNOWN`

초기 기본 임계값 예시:

- Disk WARN >= 80%
- Disk CRITICAL >= 90%
- Memory WARN >= 85%
- Memory CRITICAL >= 95%
- CPU는 순간값만으로 CRITICAL 판정하지 않고 sampling/window 또는 load와 함께 판단

실제 임계값은 구현 시 명시적으로 상수/설정으로 관리한다. 향후 `/settings`와 연결 가능하게 설계한다.

STEALTH UI에서도 `[WARN]`, `[CRITICAL]` 등 의미가 유지되어야 한다.

---

## 5. Refresh / Cache / 비용 제어

- `/system` 조회마다 무거운 shell command를 무제한 병렬 실행하지 않는다.
- 각 collector command에 timeout을 둔다.
- 짧은 TTL cache를 사용할 수 있다.
- `새로고침`은 가능하면 기존 status message를 edit한다.
- 과도한 연속 refresh에 기본 rate limit/debounce를 고려한다.

---

## 6. 안전 경계

Phase 14 `/system`은 read-only observability command다.

제외:

- `docker rm`
- `docker prune`
- arbitrary process kill
- host reboot/shutdown
- filesystem delete
- automatic container restart
- automatic disk cleanup

사용자가 자연어 Agent를 통해 FULL_ACCESS로 인프라 작업을 수행하는 기존 Phase 9 경로와 `/system` UI 자체의 권한을 분리한다.

---

## 7. 구현 예상 구성

- `src/system/system-service.js`
- CPU/Memory/Disk/Host collectors
- DockerClient summary 확장
- Agent Hub container/process collector
- `src/telegram/commands/system.js`
- Resource severity evaluator
- optional short TTL cache
- Slash command menu 갱신
- Stealth renderer 재사용

파일명은 실제 구조에 맞춰 조정 가능하다.

---

## 8. Acceptance / E2E

- [x] `/system`이 `/server` Registry의 모든 활성 서버를 동적으로 반영한다.
- [x] 서버별 SSH 실패를 격리하고 OFFLINE/UNKNOWN으로 표시한다.
- [x] `/system`에서 Host OS/Kernel/Uptime을 확인할 수 있다.
- [x] CPU usage/core/load average를 확인할 수 있다.
- [x] Host Memory/Swap 상태를 확인할 수 있다.
- [x] Disk capacity와 usage를 확인할 수 있다.
- [x] Docker running/stopped/unhealthy summary를 확인할 수 있다.
- [x] Agent Hub container/process resource를 Host resource와 구분해 표시한다.
- [x] 일부 collector가 실패해도 나머지 system 정보가 표시된다.
- [x] Resource threshold에 따라 OK/WARN/CRITICAL이 정확히 표시된다.
- [x] `/system` 자체는 destructive operation을 수행하지 않는다.
- [x] NORMAL/STEALTH UI 모두 의미가 유지된다.
- [x] 반복 refresh가 Core에 과도한 command storm을 만들지 않는다.

구현 검증: 2026-09-01 unit/integration/E2E `72 pass / 0 fail / 1 skip`. SSH 실수집으로 `dev`, `local` CPU/RAM/Disk/OS/Docker와 `dev` Agent Hub 컨테이너 식별을 확인했다.

Runtime Audit: 2026-09-01 `PASS`. Coolify 재배포 후 Telegram `/system`의 CPU/RAM/Disk/Docker/Uptime과 host 측정값이 합리적으로 일치함을 확인했다. `dev`의 고온·CPU 사용 표시는 장시간 CPU 코어 하나를 점유한 `htop` 프로세스를 실제로 반영한 값이었으며, 프로세스 종료 후 CPU idle `99~100%`, CPU 온도 `44~45°C`로 정상화되는 것까지 확인했다.

## 9. 완료 조건

- [x] 실제 Coolify Host에서 `/system` 수치와 host terminal/Docker 측정값의 합리적 일치를 검증했다.
- [x] Phase 14 Runtime Audit에서 `PASS`했다.
- [x] Phase 14를 `DONE` 처리했다.
