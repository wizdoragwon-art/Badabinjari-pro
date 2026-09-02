> 전체 배포는 상위 폴더의 **README.md**(마스터 가이드)를 따르세요. 이 문서는 봇 부분의 참고용입니다.
> 모노레포에서는 자동 실행 워크플로가 저장소 최상위 `.github/workflows/update-data.yml` 에 있습니다.

# 빈자리 알림 봇 (텔레그램) + 데이터 생성

관심 출조점(선상 낚시) 예약현황을 주기적으로 확인해서 **새로 뜬 빈자리**를 텔레그램으로 알리고, 동시에 **PWA가 읽을 `data.json`**(출조점·배·잔여석)을 만듭니다. 서버 없이 GitHub Actions 크론으로 돕니다.

## 동작 구조

```
GitHub Actions 크론(15분)
   ├─ 더피싱 파서   : 예약현황 HTML → 좌석표에서 잔여석 계산
   ├─ 선상24 어댑터 : 예약 JSON API → 잔여석
   ├─ 새 빈자리 → 텔레그램 단톡방/DM 알림
   └─ data.json 갱신 → PWA가 같은 데이터 표시
```

앱(PWA) · 텔레그램 알림 · 데이터가 모두 이 `data.json` 을 공유합니다.

## 지원 플랫폼 (어댑터)

- **thefishing** (`lib/thefishing.js`) — 더피싱/피시맵 기반 개별 선사 사이트(예: mscufishing.com).
  예약현황 페이지(`mid=bk`)의 **좌석표를 실제로 파싱**합니다.
  잔여석 = 정원 − 예약된 좌석수(입금자 `이름(N명/좌석번호)`에서 추출), 마감 이미지·`[독배]`면 0.
  물때·어종·출항시각도 함께 읽어옵니다. 정원은 좌석표의 최대 좌석번호로 자동 추정합니다.
- **sunsang24** (`lib/sunsang24.js`) — 선상24(전국 플랫폼). 각 선사는 `{선사}.sunsang24.com` 서브도메인을 가지며,
  예약 페이지 `/ship/schedule_fleet` 는 **서버 렌더링 HTML**입니다. **`남은자리 N명`을 직접 파싱**하므로 좌석 계산이 필요 없어요.
  물때·어종·운항시각도 함께 읽고, `예약마감`은 0, `출항취소`는 건너뜁니다. `months`로 이번 달+다음 달까지 봅니다.

## 설정 (`spots.json`)

```jsonc
{
  "filters": { "species": ["쭈꾸미","갑오징어","백조기"], "weekendOnly": false, "minSeats": 1 },
  "spots": [
    {
      "uid": 74,
      "name": "삼길포 씨유만석낚시",
      "platform": "thefishing",
      "reserveUrl": "http://www.mscufishing.com/index.php?mid=bk",
      "boats": [ { "name": "만석호", "cap": 15, "dep": "06:00" }, ... ]
    },
    {
      "name": "진해 반도낚시",
      "platform": "sunsang24",
      "reserveUrl": "https://bando.sunsang24.com/ship/schedule_fleet",
      "months": 2,
      "boats": [ { "name": "반도호", "cap": 20 } ]
    }
  ]
}
```

- `boats[].name` 은 더피싱에서 **배 이름 경계를 잡는 데** 쓰이니 사이트 표기와 맞춰주세요.
- `cap`(정원)은 없으면 파서가 좌석표에서 자동 추정하지만, 넣어두면 더 정확합니다.

## 설치 & 실행

1. 텔레그램 봇 만들기(@BotFather) → 토큰 발급, chat_id 확인(개인/그룹)
2. GitHub 저장소에 올리고 **Secrets**에 `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` 등록
3. `spots.json` 편집 → **Actions** 활성화 (15분마다 자동 실행 + state·data 커밋백)

로컬 테스트:
```bash
npm run test:mock     # 전송 없이 메시지 미리보기 (MOCK 데이터)
# 실제 사이트로 1회 확인 (더피싱만; 선상24는 apiUrl 필요)
node check.js
```

## PWA 연결

크론이 만든 `data.json` 을 PWA가 읽게 하면 앱·알림이 같은 실데이터로 돕니다.

- 같은 저장소를 GitHub Pages로 쓰거나, `data.json` 을 PWA 폴더로 복사되게 설정
- 또는 PWA `app.js` 의 `API_URL` 대신 이 `data.json` 경로를 fetch (앱은 이미 `data.json` 폴백을 지원)

## 참고

- 크론은 UTC 기준이며 지연될 수 있습니다. 코드에 KST 01~05시 **조용시간**을 둬 심야 반복 조회를 피합니다.
- 예약·입금은 항상 선사 예약창에서 진행하세요. 이 봇은 빈자리 발생을 알리는 용도입니다.
- 개인·지인용입니다. 사이트에 무리한 반복 조회는 피하고, 각 사이트 약관을 존중하세요.