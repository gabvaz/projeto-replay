@echo off
cd /d "%~dp0.."
echo Subindo edge local e abrindo UI em http://127.0.0.1:8788/
npm run edge:ui
