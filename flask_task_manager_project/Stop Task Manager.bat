@echo off
setlocal ENABLEEXTENSIONS ENABLEDELAYEDEXPANSION

pushd "%~dp0"
title Task Manager Stopper

set "PID_FILE=%~dp0task_manager_server.pid"

echo.
echo ==========================================
echo   Task Manager - Safe Stop
echo ==========================================
echo.
echo This only stops the local Task Manager server.
echo Saved tasks, users, messages, uploads, and database files are not edited.
echo.

set "STOPPED_ANY=0"
set "NEED_ADMIN=0"

net session >nul 2>nul
if errorlevel 1 (
    set "IS_ADMIN=0"
) else (
    set "IS_ADMIN=1"
)

if exist "%PID_FILE%" (
    set /p SERVER_PID=<"%PID_FILE%"
    if defined SERVER_PID (
        echo Stopping recorded server process tree:
        echo   PID %SERVER_PID%
        taskkill /PID %SERVER_PID% /T /F
        if not errorlevel 1 (
            set "STOPPED_ANY=1"
            echo Recorded server process tree stopped.
        ) else (
            echo The recorded process was already closed or could not be stopped.
            set "NEED_ADMIN=1"
        )
    ) else (
        echo The PID file was empty.
    )
) else (
    echo No PID file found. Checking port 5000 directly...
)

echo.
echo Checking for anything still listening on port 5000...
set "FOUND_PORT_PROCESS=0"
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":5000 .*LISTENING"') do (
    set "FOUND_PORT_PROCESS=1"
    echo Stopping process using port 5000:
    echo   PID %%P
    taskkill /PID %%P /T /F
    if not errorlevel 1 (
        set "STOPPED_ANY=1"
        echo Port 5000 process stopped.
    ) else (
        echo Could not stop PID %%P. Close the server console manually if it is still open.
        set "NEED_ADMIN=1"
    )
)

if "%FOUND_PORT_PROCESS%"=="0" (
    echo Nothing is listening on port 5000.
)

if exist "%PID_FILE%" del /q "%PID_FILE%" >nul 2>nul

echo.
if "%NEED_ADMIN%"=="1" if "%IS_ADMIN%"=="0" (
    echo Windows blocked the stop command with normal permissions.
    echo Opening an administrator stop window now. Approve the Windows prompt if it appears.
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -WorkingDirectory '%~dp0' -Verb RunAs"
    goto :end_no_pause
)

if "%STOPPED_ANY%"=="1" (
    echo Task Manager has been stopped safely.
) else (
    echo No running Task Manager server was found.
)
echo Saved data was not changed.

echo.
pause

:end_no_pause
popd
endlocal
