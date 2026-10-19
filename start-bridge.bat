@echo off
chcp 65001 >nul
title QQ Bridge
cd /d D:\Temp\qq-bridge
start "" /b cmd /c "D:\node.exe scripts\proactive.mjs 2>> state\proactive.err.log"
start "" /b cmd /c "D:\node.exe scripts\diary.mjs 2>> state\diary.err.log"
D:\npm.cmd start
echo.
echo Bridge stopped. Press any key to close.
pause >nul
