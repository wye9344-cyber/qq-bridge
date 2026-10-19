@echo off
chcp 65001 >nul
title Whale One-Click Start
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "D:\Temp\qq-bridge\start-all.ps1"
if errorlevel 1 pause
