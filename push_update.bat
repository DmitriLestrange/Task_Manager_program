@echo off
setlocal

cd /d "%~dp0"

git add .
git commit -m "Auto update"
git pull origin main --rebase
git push

pause