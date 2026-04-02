@echo off
echo ========================================================
echo Slay the Spire 2 Card Art Editor 로컬 서버 실행
echo ========================================================
echo.
echo 브라우저 보안 정책(CORS)으로 인해 로컬 파일(file://) 환경에서는
echo cards.csv 파일을 직접 불러올 수 없습니다.
echo 이를 해결하기 위해 로컬 웹 서버를 실행하여 에디터를 엽니다.
echo.
echo 브라우저 창이 열리면 바로 사용하실 수 있습니다.
echo 종료하시려면 이 명령 프롬프트 창을 닫아주세요.
echo.
start http://localhost:8000
python -m http.server 8000
