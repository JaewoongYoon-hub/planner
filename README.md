# 계획·실적 플래너

월간과 주간이 연동되는 계획·실적 플래너입니다. 태블릿에 설치하면 인터넷 없이도 열리고, 같은 계정으로 로그인한 기기끼리는 인터넷이 될 때 기록이 동기화됩니다.

- `index.html`: 앱 (`src/build.py`가 `src/planner_app.html`로 만듭니다)
- `sync.js`: Firebase 동기화 (항목별 병합, 같은 항목을 양쪽에서 고치면 나중 것이 남고 다른 쪽은 충돌 기록에 보관)
- `config.js`: Firebase 프로젝트 정보
- `firestore.rules`: Firestore 보안 규칙 (본인 기록만 읽고 쓰기)
- `lib/`: Firebase JS SDK 10.12.2 (오프라인에서도 열리도록 함께 배포)
- `sw.js`, `manifest.json`: 오프라인 실행과 홈 화면 설치
