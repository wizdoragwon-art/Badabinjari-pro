# 집 컴퓨터(윈도우)에서 봇 돌리기

삼길포(mscufishing) 서버가 GitHub 서버 접속을 막아서, **집 컴퓨터에서 봇을 돌려** 데이터를 만들고 GitHub에 올리는 방법입니다. 집 인터넷은 차단되지 않아 삼길포가 됩니다.

```
집 컴퓨터: 예약현황 긁기 → data.json 생성 → GitHub에 push
              ↓
     GitHub Pages → 폰 앱(PWA)이 최신 데이터 표시
```

---

## 준비 (한 번만)

### 1. Node.js 설치
- https://nodejs.org 에서 **LTS** 버전 다운로드 → 설치 (계속 "다음")
- 확인: **명령 프롬프트**(cmd)에서 `node -v` 입력 → 버전 나오면 OK

### 2. Git 설치
- https://git-scm.com/download/win 에서 다운로드 → 설치 (기본값으로 계속)
- 확인: cmd에서 `git --version`

### 3. 저장소를 집 컴퓨터로 내려받기
cmd에서 (원하는 폴더로 이동 후):
```
git clone https://github.com/<내아이디>/<저장소이름>.git
cd <저장소이름>
```
- 처음 git push 할 때 GitHub 로그인(브라우저 인증)이 뜨면 로그인하세요.

### 4. 키 파일 만들기
- `telegram-bot` 폴더에서 **`keys.bat.example`** 을 복사해서 **`keys.bat`** 으로 이름 바꾸기
- `keys.bat` 을 메모장으로 열어 값 4개를 채우기:
  - `TELEGRAM_BOT_TOKEN` = 텔레그램 봇 토큰
  - `TELEGRAM_CHAT_ID` = 챗 아이디
  - `KHOA_KEY` = 국립해양조사원 인증키
  - `SHEET_URL` = Apps Script 웹앱 /exec 주소
- (keys.bat 은 깃허브에 안 올라갑니다)

### 5. GitHub Actions 자동실행 끄기 (권장)
집에서 돌리면 GitHub의 크론과 겹쳐 삼길포 없는 데이터로 덮어쓸 수 있어요.
- 저장소 `.github/workflows/update-data.yml` 을 열어 상단 `schedule:` ~ `cron:` 두 줄을 **주석 처리(앞에 # )** 하거나, Actions 탭에서 워크플로를 **Disable**.

---

## 수동 실행

`telegram-bot` 폴더의 **`run.bat` 더블클릭**.
- 봇이 예약현황을 긁고 → `pwa/data.json` 갱신 → GitHub에 자동 업로드
- 검은 창에 `[완료] 최신 데이터를 GitHub에 올렸습니다.` 가 나오면 성공
- 잠시 후 폰 앱을 새로고침하면 반영됩니다

---

## 자동 실행 (작업 스케줄러)

컴퓨터가 켜져 있을 때 주기적으로 자동 실행되게 합니다.

1. 시작 메뉴에서 **작업 스케줄러** 실행
2. 오른쪽 **기본 작업 만들기**
3. 이름: `물때빈자리 봇` → 다음
4. 트리거: **매일** → 다음 → 시작 시간 정하기 (예: 07:00)
   - 더 자주 원하면: 만든 뒤 작업 속성 → **트리거** 탭 → 편집 → "작업 반복 간격" 30분, "기간" 무기한
5. 동작: **프로그램 시작** → 다음
6. 프로그램/스크립트: `run.bat` 의 전체 경로 찾아보기
   (예: `C:\Users\내이름\mulddae-binjari\telegram-bot\run.bat`)
7. **인수 추가**: `auto`  ← (이걸 넣으면 자동 실행 시 창이 안 뜨고 바로 닫힘)
8. **시작 위치**: `telegram-bot` 폴더 경로
   (예: `C:\Users\내이름\mulddae-binjari\telegram-bot`)
9. 마침

> 팁: 작업 속성 → "사용자가 로그온했는지 여부에 관계없이 실행", "가장 높은 수준의 권한으로 실행" 체크하면 더 안정적이에요.

---

## 확인 & 문제 해결

- **run.bat 창에 `fetch 실패`가 여전함** → 집에서도 안 되면 그 사이트가 잠시 다운된 것. 나중에 다시 실행.
- **`node 명령을 찾을 수 없음`** → Node.js 재설치 후 cmd 새로 열기.
- **git push 오류(인증)** → 처음 한 번 cmd에서 수동으로 `git push` 해서 로그인 완료해두기.
- **한글이 깨져 보임** → 창 표시 문제일 뿐 동작엔 지장 없음.
- **컴퓨터 꺼져 있던 시간** → 그 시간 갱신은 건너뜀. 다음 실행 때 최신으로 채워짐.

---

## 요약
1. Node·Git 설치 → 저장소 clone
2. `keys.bat` 만들어 키 4개 채우기
3. GitHub Actions 크론 끄기
4. 수동: `run.bat` 더블클릭 / 자동: 작업 스케줄러에 `run.bat auto` 등록
