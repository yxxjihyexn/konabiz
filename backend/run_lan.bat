@echo off
chcp 65001 > nul
rem 발표용 실행 — 같은 네트워크의 다른 PC에서 접속할 수 있게 0.0.0.0:8000으로 띄움 (자동 새로고침 없음)
rem 이 파일은 UTF-8 + CRLF여야 함 (LF면 cmd가 한글 줄을 잘못 읽음 — .gitattributes)
cd /d "%~dp0"

if not exist ".venv\Scripts\activate.bat" (
  echo [오류] backend\.venv가 없습니다. README "실행 방법"대로 가상환경을 먼저 만드세요.
  pause
  exit /b 1
)
call .venv\Scripts\activate.bat

rem 기본 게이트웨이가 있는(실제로 연결된) 어댑터의 IPv4 주소
set "LAN_IP="
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } | ForEach-Object { $_.IPv4Address.IPAddress } | Select-Object -First 1"`) do set "LAN_IP=%%i"

echo.
if defined LAN_IP (
  echo 강사님 PC에서 이 주소로 접속: http://%LAN_IP%:8000
) else (
  echo [안내] IPv4 주소를 찾지 못했습니다. ipconfig 로 "IPv4 주소"를 확인하세요.
)
echo 이 PC에서 확인: http://localhost:8000
echo 끄기: Ctrl+C
echo.

python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
pause
