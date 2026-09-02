# 물때빈자리 — 배포 가이드

서해 선상 낚시 **빈자리·물때·날씨**를 한 화면에서 보고, 빈자리가 뜨면 **텔레그램**으로 알려주는 개인·지인용 시스템입니다. 서버 없이 **GitHub + 구글**만으로 돌아갑니다.

## 구성 (3부분)

```
mulddae-binjari/
├─ pwa/            ① 설치형 웹앱(PWA)  → GitHub Pages 로 배포
├─ telegram-bot/   ② 빈자리 수집 + 텔레그램 알림 → GitHub Actions 로 자동 실행
├─ apps-script/    ③ 구글 시트 백엔드(선택) → Google Apps Script 에 붙여넣기
└─ .github/workflows/update-data.yml   ← 봇 자동 실행 설정(모노레포)
```

## 어떻게 맞물리나

```
   [예약 사이트: 더피싱 / 선상24]
              │  ② 봇이 15분마다 파싱
              ▼
        pwa/data.json  ←──────────┐
        (출조점·배·빈자리)          │ ③ 시트(선택): 날씨·지인 공유 URL
              │                    │
   ① PWA가 읽어 화면 표시      Apps Script(API_URL)
              │                    │
        ② 새 빈자리 → 텔레그램 알림 ┘
```

- **①PWA**: 화면. `pwa/data.json` 을 읽어 빈자리·물때·날씨를 보여줌.
- **②텔레그램 봇**: 15분마다 예약현황을 파싱해 **새 빈자리를 텔레그램으로 알림** + `pwa/data.json` 갱신.
- **③구글 시트(선택)**: 지인이 URL 공유 → 시트에 누적, 날씨(파고 포함) 제공. 안 써도 앱·알림은 동작합니다.

---

# 준비물

- GitHub 계정 (무료) — 앱 호스팅 + 봇 자동 실행
- 텔레그램 앱 — 알림 받을 봇
- (선택) 구글 계정 — 시트 백엔드

---

# STEP 1. GitHub 저장소에 올리기

1. GitHub에서 **New repository** → 이름(예: `mulddae-binjari`) → **Private** 권장 → Create
2. 이 폴더(`mulddae-binjari`) 안의 내용을 저장소에 올립니다.
   - 쉬운 방법: 저장소 페이지 **Add file → Upload files** 로 `pwa/`, `telegram-bot/`, `apps-script/`, `.github/` 를 그대로 드래그해 업로드 → Commit
   - 또는 git 사용:
     ```bash
     cd mulddae-binjari
     git init && git add . && git commit -m "init"
     git branch -M main
     git remote add origin https://github.com/<아이디>/mulddae-binjari.git
     git push -u origin main
     ```

> `.github/workflows/update-data.yml` 은 **반드시 저장소 최상위**에 있어야 자동 실행됩니다(이미 그렇게 배치돼 있습니다).

---

# STEP 2. PWA를 GitHub Pages로 배포 (설치까지)

1. 저장소 **Settings → Pages**
2. **Build and deployment → Source: Deploy from a branch**
3. Branch: **main**, 폴더: **/ (root)** → Save
4. 1~2분 후 주소가 나옵니다: `https://<아이디>.github.io/mulddae-binjari/`
5. 앱 주소는 그 뒤에 `pwa/` 를 붙입니다:
   **`https://<아이디>.github.io/mulddae-binjari/pwa/`**

### 폰에 설치
- **아이폰(사파리)**: 위 주소 접속 → 공유 → **홈 화면에 추가**
- **안드로이드(크롬)**: 접속하면 뜨는 **설치** 배너, 또는 메뉴 → 홈 화면에 추가

> 처음엔 `pwa/data.json` 에 샘플만 있어 빈자리가 임시값으로 보일 수 있어요. STEP 3을 마치면 실데이터로 바뀝니다.

---

# STEP 3. 텔레그램 봇 (빈자리 알림 + 데이터 갱신)

### 3-1. 봇 만들기
1. 텔레그램에서 **@BotFather** 검색 → `/newbot` → 이름·아이디 정하기
2. 발급된 **토큰** 복사 (예: `123456:ABC...`)

### 3-2. chat_id 알아내기
- **개인 DM**: 만든 봇과 대화창을 열고 아무 메시지나 전송 → 브라우저에서
  `https://api.telegram.org/bot<토큰>/getUpdates` 접속 → `chat.id` 숫자 확인
- **지인 단톡방**: 그룹에 봇을 초대하고 아무 메시지 전송 → 위 주소에서 `chat.id`(음수, 예 `-100…`) 확인

### 3-3. GitHub에 비밀값 등록
저장소 **Settings → Secrets and variables → Actions → New repository secret** 로 2개 추가:
- `TELEGRAM_BOT_TOKEN` = 봇 토큰
- `TELEGRAM_CHAT_ID` = 위에서 찾은 chat_id

### 3-4. 자동 실행 켜기
- 저장소 **Actions** 탭 → 워크플로 활성화(Enable) → **Run workflow** 로 1회 수동 실행해 확인
- 이후 15분마다 자동으로: 예약현황 파싱 → 새 빈자리 텔레그램 전송 → `pwa/data.json` 갱신(커밋)
- Pages가 갱신된 `data.json` 을 서빙하므로 **앱도 같은 실데이터**를 보여줍니다.

> 로컬에서 먼저 테스트하려면 `telegram-bot/README.md` 의 `MOCK` / `DRY_RUN` 참고.

---

# STEP 4. (선택) 구글 시트 백엔드 — 날씨 + 지인 URL 공유

날씨(파고 포함)와 “지인이 URL 공유” 기능을 원하면 진행하세요. 안 해도 빈자리·알림은 동작합니다.

1. 구글 드라이브에서 **새 스프레드시트** 생성
2. **확장 프로그램 → Apps Script** → `apps-script/Code.gs` 내용 붙여넣기 → 저장
3. 함수 목록에서 **`setup`** 실행(권한 승인) → 탭·기본값 생성
4. **배포 → 새 배포 → 웹 앱** (액세스: **모든 사용자**) → **웹앱 URL(/exec)** 복사
5. `pwa/app.js` 맨 위 `API_URL` 에 그 URL 붙여넣기 → 저장/커밋
   ```js
   const API_URL = "https://script.google.com/macros/s/XXXX/exec";
   ```
6. 시트 **Config** 탭에서 `LAT`/`LON` 을 출조 지역으로 바꾸면 날씨가 반영됩니다.

자세한 내용: `apps-script/README.md`

---

# 관심 선사 추가하기 (`telegram-bot/spots.json`)

내가 다니는 출조점을 넣으면 그곳 빈자리를 추적합니다. **두 플랫폼**을 지원해요.

### 더피싱 계열 (개별 선사 사이트, 예: mscufishing.com)
```jsonc
{
  "uid": 74,
  "name": "삼길포 씨유만석낚시",
  "port": "충남 서산 삼길포",
  "platform": "thefishing",
  "reserveUrl": "http://www.mscufishing.com/index.php?mid=bk",
  "boats": [ { "name": "만석호", "cap": 15, "dep": "06:00" } ]
}
```
- `reserveUrl` 은 그 사이트의 **예약현황 페이지(보통 `?mid=bk`)**.
- `boats[].name` 은 사이트의 배 이름과 똑같이. `cap`(정원)은 없으면 자동 추정.

### 선상24 계열 (`○○.sunsang24.com`)
```jsonc
{
  "name": "진해 반도낚시",
  "platform": "sunsang24",
  "reserveUrl": "https://bando.sunsang24.com/ship/schedule_fleet",
  "months": 2,
  "boats": [ { "name": "반도호", "cap": 20 } ]
}
```
- 각 선사는 서브도메인이 있습니다. 주소를 그 선사의 `.../ship/schedule_fleet` 로 바꾸세요.
- `months: 2` 면 이번 달+다음 달을 봅니다.

수정 후 저장소에 커밋하면 다음 실행부터 반영됩니다.

### 알림 필터
```jsonc
"filters": { "species": ["쭈꾸미","갑오징어","백조기"], "weekendOnly": false, "minSeats": 1 }
```

---

# 잘 되는지 확인 / 문제 해결

- **앱이 안 열려요** → Pages 주소 뒤에 `pwa/` 를 붙였는지 확인. Pages 반영에 1~2분 소요.
- **설치 배너가 안 떠요** → HTTPS 필요(GitHub Pages는 기본 HTTPS). 아이폰은 배너 없이 공유→홈 화면에 추가.
- **텔레그램 알림이 안 와요** → Actions 로그 확인. Secrets(토큰·chat_id) 오타, 봇에게 먼저 말 걸었는지, 그룹이면 chat_id 음수인지 확인.
- **빈자리가 임시값 같아요** → 아직 봇이 안 돌았거나 `spots.json` 이 비어 있음. Actions에서 1회 실행.
- **파싱이 이상해요** → 사이트가 개편되면 파서(`telegram-bot/lib/*.js`)를 손봐야 합니다. 배포 첫 며칠은 값이 맞는지 눈으로 확인 권장.
- **크론이 정확히 15분마다는 아님** → GitHub 무료 크론은 부하에 따라 몇 분 지연될 수 있습니다.

---

# 주의사항

- 개인·지인용입니다. 사이트에 무리한 반복 조회는 피하세요(코드에 KST 01~05시 조용시간 있음).
- 예약·입금은 **항상 선사 예약창**에서 진행하세요. 이 시스템은 빈자리 발생을 알리는 용도입니다.
- 각 사이트의 이용약관을 존중하세요. 데이터 무단 재배포는 하지 마세요.
- Pages를 Public으로 두면 주소를 아는 사람은 앱을 볼 수 있습니다. 민감정보는 넣지 마세요.
