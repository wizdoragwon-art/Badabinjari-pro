# 물때빈자리 — 설치형 PWA

서해 선상 낚시 **빈자리·물때·날씨**를 한 화면에서 보는 개인용 앱. 홈 화면에 설치되고, 오프라인에서도 마지막 데이터를 보여줍니다.

## 파일 구성

```
pwa/
  index.html              앱 셸 + 스타일
  app.js                  앱 본체 (의존성 없음, 바닐라 JS)
  sw.js                   서비스워커 (앱셸 캐시우선 / data.json 네트워크우선)
  manifest.webmanifest    설치 매니페스트
  data.json               빈자리 데이터 (알림봇 스크래퍼가 갱신)
  icons/                  앱 아이콘 (192·512·maskable·apple-touch)
```

## 바로 실행 (로컬 테스트)

서비스워커는 `file://` 에서 동작하지 않으니 로컬 서버로 엽니다.

```bash
cd pwa
python3 -m http.server 8080
# 브라우저에서 http://localhost:8080
```

## 배포 (GitHub Pages, 무료 HTTPS)

1. 이 `pwa/` 내용을 GitHub 저장소에 올림
2. **Settings → Pages** 에서 브랜치 지정 (예: `main` / 루트 또는 `/docs`)
3. 발급된 `https://<아이디>.github.io/<저장소>/` 주소로 접속
   - 경로가 하위 폴더라도 동작하도록 `start_url`·`scope`·모든 링크를 상대경로(`.`)로 작성해 두었습니다.

> HTTPS여야 설치·서비스워커가 동작합니다. GitHub Pages는 기본 HTTPS라 그대로 됩니다.

## 설치

- **Android/데스크톱(Chrome)**: 접속하면 상단에 "설치" 바가 뜨거나, 주소창 설치 아이콘 사용
- **iOS(Safari)**: 공유 → **홈 화면에 추가** (iOS는 자동 설치 배너가 없음)

## 백엔드 연결 (구글 시트 + Apps Script)

지인이 URL을 공유해 시트에 쌓고, 날씨를 시트 설정으로 적용하려면 `apps-script/` 백엔드를 배포한 뒤, `app.js` 맨 위의 `API_URL` 에 웹앱 `/exec` 주소를 넣습니다.

```js
const API_URL = "https://script.google.com/macros/s/XXXX/exec";
```

- 비워두면 로컬 `data.json` 으로 동작(오프라인 데모).
- 연결하면: 시트의 출조점·배·**지인 공유목록·실측 날씨(파고 포함)** 를 읽어오고,
  선사추가 화면의 "🔗 지인에게 공유" 버튼이 URL을 시트에 등록합니다.
- 자세한 시트 구조·날씨 설정은 `apps-script/README.md` 참고.

## 알림봇과 연결 (빈자리 텔레그램 알림)

이 앱은 화면 표시, 실제 **알림은 `binjari-alert`(텔레그램 봇)** 가 담당합니다. 둘을 잇는 접점이 `data.json` 입니다.

```
binjari-alert (GitHub Actions 크론)
   └─ 예약현황 파싱 → data.json 갱신 + 새 빈자리 텔레그램 전송
물때빈자리 PWA
   └─ data.json 을 읽어 캘린더에 빈자리 표시 (네트워크 우선 캐싱)
```

권장 구성: **한 저장소**에 알림봇과 PWA를 함께 두고, 크론이 `pwa/data.json` 을 갱신하도록 하면 앱과 알림이 같은 데이터를 씁니다.

## 지금 동작 방식 / 다음 단계

- `data.json` 의 `availability` 가 비어 있으면, 앱이 **임시로 자체 생성한 잔여석**을 보여줍니다(데모용). 스크래퍼가 값을 채우면 자동으로 실데이터로 바뀝니다.
- **물때**는 앱에서 계산(오프라인 가능), **날씨**는 현재 데모값 — 다음 단계에서 Open-Meteo/기상청 API 또는 `data.json` 로 교체하면 됩니다.
- **선사 추가(URL)** 는 지금 감지 시뮬레이션이며, 추가한 출조점은 이 기기(localStorage)에 저장됩니다. 실제 연동은 알림봇의 파서와 이어집니다.

## 저장되는 것 (이 기기)

- 담아둔 배(알림 목록), URL로 추가한 출조점 → `localStorage`
- 마지막 데이터/앱셸 → 서비스워커 캐시 (오프라인 표시용)
