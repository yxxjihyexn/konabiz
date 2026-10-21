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

rem 포트: 기본 8000, 확인용으로 다른 포트를 줄 수 있음 (예: run_lan.bat 8001)
set "PORT=8000"
if not "%~1"=="" set "PORT=%~1"

rem 기본 게이트웨이가 있는(실제로 연결된) 어댑터의 IPv4 주소
set "LAN_IP="
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } | ForEach-Object { $_.IPv4Address.IPAddress } | Select-Object -First 1"`) do set "LAN_IP=%%i"

echo.
if defined LAN_IP (
  echo 강사님 PC에서 이 주소로 접속: http://%LAN_IP%:%PORT%
) else (
  echo [안내] IPv4 주소를 찾지 못했습니다. ipconfig 로 "IPv4 주소"를 확인하세요.
)
echo 이 PC에서 확인: http://localhost:%PORT%
echo 끄기: Ctrl+C  (창을 클릭해도 멈추지 않음. 그래도 멈추면 Esc)
echo.

rem 이 창의 빠른 편집(QuickEdit)을 끄고 uvicorn 실행 — 켜져 있으면 창을 클릭(선택)하는 순간 서버 출력이 멈춰 응답도 멈춤
rem cmd는 외부 프로그램이 끝나면 콘솔 모드를 되돌리므로, 끄기와 서버 실행을 같은 python 프로세스에서 함
rem ENABLE_QUICK_EDIT_MODE(0x40) 빼고 ENABLE_EXTENDED_FLAGS(0x80) 켬. 실패해도 서버는 그대로 실행
python -c "import ctypes as c, runpy, sys; k=c.windll.kernel32; h=k.GetStdHandle(-10); m=c.c_uint32(); k.GetConsoleMode(h, c.byref(m)) and k.SetConsoleMode(h, (m.value & ~0x40) | 0x80); sys.argv=['uvicorn', 'app.main:app', '--host', '0.0.0.0', '--port', '%PORT%']; runpy.run_module('uvicorn', run_name='__main__')"
pause
