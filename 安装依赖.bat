@echo off
chcp 65001 >nul
cd /d %~dp0
echo [1/2] 正在安装前端依赖（React + 组件库，首次需几分钟）...
call npm install
if errorlevel 1 (
  echo npm 不可用或安装失败。请先安装 Node.js（含 npm）后重试。
  pause
  exit /b 1
)
echo.
echo [2/2] 正在安装/更新 yt-dlp（抖音解析与视频下载工具）...
pip install -U yt-dlp
if errorlevel 1 (
  echo pip 不可用，尝试 python -m pip ...
  python -m pip install -U yt-dlp
)
echo.
echo 全部完成。以后双击「启动.bat」即可使用。
echo 改了前端代码想生效：删除 dist 文件夹后重新双击「启动.bat」，或运行 npm run build。
pause
