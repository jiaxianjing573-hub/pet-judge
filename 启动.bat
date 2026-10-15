@echo off
chcp 65001 >nul
cd /d %~dp0
if not exist dist (
  echo 未找到构建产物，正在构建前端（首次约需十几秒）...
  call npm run build
  if errorlevel 1 (
    echo 构建失败。请先双击「安装依赖.bat」安装依赖后重试。
    pause
    exit /b 1
  )
)
start "" /min cmd /c "timeout /t 2 >nul && start "" http://localhost:3212"
node server.js
pause
