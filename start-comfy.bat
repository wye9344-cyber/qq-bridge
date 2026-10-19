@echo off
chcp 65001 >nul
title ComfyUI
cd /d "D:\comfy ui\ComfyUI-aki-v3.2\ComfyUI"
"D:\comfy ui\ComfyUI-aki-v3.2\python\python.exe" main.py --listen 127.0.0.1 --port 8188
echo.
echo ComfyUI stopped. Press any key to close.
pause >nul
