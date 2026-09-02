# 물때빈자리 백엔드 (Google Sheets + Apps Script)

서버 없이 **구글 시트를 DB로, Apps Script를 API로** 쓰는 개인·지인용 백엔드입니다.

- 지인이 예약 사이트 **URL을 공유하면 시트에 쌓임** (Submissions)
- PWA가 읽을 **데이터(출조점·배·공유목록·날씨)를 JSON**으로 제공
- **날씨는 Config 시트 설정만으로 적용** (기본 Open-Meteo, API 키 불필요·파고 포함)

## 설치 (5분)

1. 구글 드라이브에서 **새 스프레드시트** 생성
2. **확장 프로그램 → Apps Script** 열기
3. `Code.gs` 내용을 붙여넣고 저장 (원하면 `appsscript.json`도 매니페스트에 반영)
4. 함수 목록에서 **`setup`** 선택 후 실행 → 권한 승인
   - `Spots`, `Boats`, `Submissions`, `Config` 탭과 예시 데이터가 생성됩니다
5. **배포 → 새 배포 → 유형: 웹 앱**
   - 실행 계정: 나
   - 액세스 권한: **모든 사용자**
   - 배포 후 **웹 앱 URL(`.../exec`)** 복사
6. PWA `app.js` 맨 위 `API_URL` 에 그 URL 붙여넣기 → 끝

## 시트 구조

**Spots** — 출조점 (앱에 표시할 것만 `active=TRUE`)

| name | port | active | lat | lon |
|------|------|--------|-----|-----|
| 삼길포 씨유만석낚시 | 충남 서산 삼길포 | TRUE | 36.99 | 126.35 |

**Boats** — 배 (Spots의 `name`과 `spot`으로 연결)

| spot | name | species | dep | fee | cap | minGo | url |
|------|------|---------|-----|-----|-----|-------|-----|
| 삼길포 씨유만석낚시 | 만석호 | 쭈꾸미,갑오징어 | 일출 | | 20 | 10 | http://…/index.php?mid=bk |

**Submissions** — 지인이 공유한 URL이 자동으로 쌓이는 곳 (건드릴 필요 없음)

| timestamp | url | name | by | note |
|-----------|-----|------|----|----|

**Config** — 설정 (key/value)

| key | value | 설명 |
|-----|-------|------|
| WEATHER_PROVIDER | open-meteo | `open-meteo`(키 불필요·파고O) 또는 `openweather` |
| WEATHER_API_KEY | | openweather 쓸 때만 |
| LAT | 36.99 | 예보 기준 위도 |
| LON | 126.35 | 예보 기준 경도 |
| TZ | Asia/Seoul | |
| FORECAST_DAYS | 14 | |

## 날씨 적용 방법

- 기본은 **Open-Meteo(키 불필요)** — `LAT`/`LON`만 출조 지역으로 바꾸면 바로 기온·풍속(m/s)·강수확률·**파고**가 앱에 반영됩니다.
- 다른 API를 쓰고 싶으면 `WEATHER_PROVIDER=openweather` + `WEATHER_API_KEY`에 키를 넣으면 됩니다(파고는 Open-Meteo만 제공).
- 결과는 30분 캐시됩니다.

## 동작 확인

- 브라우저에서 `웹앱URL?action=data` → JSON이 보이면 정상
- URL 공유 테스트: `웹앱URL?action=submit&url=www.test.com` → Submissions에 한 줄 추가
- Apps Script 편집기에서 `testBuild` 실행 → 로그로 전체 JSON 확인

## PWA와의 연결

```
PWA (app.js)
  └─ API_URL?action=data  →  시트의 출조점·배·공유목록·날씨(JSON)
  └─ POST(공유한 URL)      →  Submissions 시트에 누적
```

`API_URL`을 비워두면 PWA는 로컬 `data.json`으로 동작합니다(오프라인 데모).

## 참고

- 잔여석(availability)은 아직 비어 있습니다 — 알림봇의 예약현황 파서가 채울 자리예요. 그때까지 앱은 임시로 자체 생성한 값을 보여줍니다.
- 액세스를 "모든 사용자"로 열면 URL을 아는 사람은 데이터 조회·URL 제출이 가능합니다. 개인·지인용으로는 충분하지만, 민감정보는 시트에 넣지 마세요.
