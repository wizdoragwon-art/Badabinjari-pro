@echo off
chcp 65001 >nul
rem ===== 물때빈자리 봇 실행 (윈도우) =====
rem 이 파일(run.bat)은 telegram-bot 폴더 안에 있어야 합니다.
rem 수동: 더블클릭 / 자동: 작업 스케줄러에 이 파일을 등록

cd /d "%~dp0"

rem 키 불러오기 (keys.bat)
if exist keys.bat (
  call keys.bat
) else (
  echo [오류] keys.bat 이 없습니다. keys.bat.example 을 복사해 keys.bat 로 만들고 값을 채우세요.
  pause
  exit /b 1
)

rem PWA가 읽는 위치로 data.json 출력
set DATA_OUT=../pwa/data.json

echo.
echo [%date% %time%] 봇 실행 중...
node check.js
if errorlevel 1 (
  echo [오류] 봇 실행 실패 (Node.js 설치 여부 확인)
  pause
  exit /b 1
)

rem 저장소 루트로 이동해서 커밋/푸시
cd ..
git add pwa/data.json telegram-bot/state.json
git diff --cached --quiet
if errorlevel 1 (
  git commit -m "update reservations [skip ci]"
  git pull --rebase origin main
  git push
  echo.
  echo [완료] 최신 데이터를 GitHub에 올렸습니다.
) else (
  echo.
  echo [정보] 변경된 내용이 없습니다.
)

rem 수동 실행 시 창이 바로 닫히지 않게(자동 실행 땐 아래 pause가 무시되도록 인자로 제어)
if "%1"=="auto" ( exit /b 0 ) else ( echo. & pause )
