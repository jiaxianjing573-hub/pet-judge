@echo off
chcp 65001 >nul
cd /d %~dp0
echo 开发模式：改代码即时热更新（需先运行过「安装依赖.bat」）
echo 正在同时启动后端(3212)与前端开发服务器(5173)...
start "pet-judge-backend" cmd /k node server.js
start "" /min cmd /c "timeout /t 3 >nul && start "" http://localhost:5173"
npm run dev
