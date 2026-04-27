@echo off
setlocal ENABLEEXTENSIONS

pushd "%~dp0"
title Task Manager Launcher (LAN)

echo.
echo ==========================================
echo   Task Manager - Local Network Launcher
echo ==========================================
echo.

if exist ".venv\Scripts\activate.bat" (
    echo Using virtual environment: .venv
    call ".venv\Scripts\activate.bat"
) else (
    if exist "venv\Scripts\activate.bat" (
        echo Using virtual environment: venv
        call "venv\Scripts\activate.bat"
    )
)

set "PYTHON_CMD="
where py >nul 2>nul
if not errorlevel 1 set "PYTHON_CMD=py -3"
if not defined PYTHON_CMD (
    where python >nul 2>nul
    if not errorlevel 1 set "PYTHON_CMD=python"
)
if not defined PYTHON_CMD (
    echo Python was not found on this computer.
    echo Install Python 3, then run this launcher again.
    goto :fail
)

echo Checking Python packages...
%PYTHON_CMD% -c "import flask, flask_socketio" >nul 2>nul
if errorlevel 1 (
    echo Missing packages found. Installing from requirements.txt...
    %PYTHON_CMD% -m pip install -r requirements.txt
    if errorlevel 1 (
        echo Failed to install required packages.
        echo Try running this launcher again, or install packages manually with:
        echo   %PYTHON_CMD% -m pip install -r requirements.txt
        goto :fail
    )
)

set "HOST_IP="
for /f "usebackq delims=" %%I in (`powershell -NoProfile -Command "$ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue ^| Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254*' -and $_.PrefixOrigin -ne 'WellKnown' } ^| Sort-Object InterfaceMetric, SkipAsSource ^| Select-Object -First 1 -ExpandProperty IPAddress; if (-not $ip) { try { $client = New-Object System.Net.Sockets.UdpClient; $client.Connect('1.1.1.1',80); $ip = $client.Client.LocalEndPoint.Address.IPAddressToString; $client.Close() } catch {} }; if (-not $ip) { $ip = '127.0.0.1' }; Write-Output $ip"`) do set "HOST_IP=%%I"
if not defined HOST_IP set "HOST_IP=127.0.0.1"

set "APP_HOST=0.0.0.0"
set "APP_URL=http://%HOST_IP%:5000/"
set "PID_FILE=%~dp0task_manager_server.pid"

echo Local network address:
echo   %APP_URL%
echo.
echo Other devices on the same Wi-Fi/network can connect with that address.
echo If they cannot connect, Windows Firewall may ask you to allow Python.
echo.

echo Checking for an already running LAN server...
powershell -NoProfile -Command "try { $response = Invoke-WebRequest -UseBasicParsing -Uri '%APP_URL%api/updates' -TimeoutSec 3; if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { exit 0 } else { exit 1 } } catch { exit 1 }"
if not errorlevel 1 (
    echo Existing Task Manager server detected.
    echo Opening:
    echo   %APP_URL%
    start "" "%APP_URL%"
    goto :end
)

echo Starting Task Manager for local network use...
echo Running in:
echo   %CD%
echo.
echo Launching server console...
if exist "%PID_FILE%" del /q "%PID_FILE%" >nul 2>nul
for /f "usebackq delims=" %%I in (`powershell -NoProfile -Command "$env:TASK_MANAGER_HOST='%APP_HOST%'; $p = Start-Process -FilePath 'cmd.exe' -WorkingDirectory '%~dp0' -ArgumentList '/k','call ""%~dp0Run Task Manager Server.bat""' -PassThru; Write-Output $p.Id"`) do set "SERVER_PID=%%I"
if not defined SERVER_PID (
    echo Could not start the server process.
    goto :fail
)
> "%PID_FILE%" echo %SERVER_PID%
echo Server PID:
echo   %SERVER_PID%

echo Waiting for the server to start...
powershell -NoProfile -Command "$deadline=(Get-Date).AddSeconds(45); $ready=$false; while((Get-Date) -lt $deadline) { try { $response = Invoke-WebRequest -UseBasicParsing -Uri '%APP_URL%api/updates' -TimeoutSec 3; if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { $ready=$true; break } } catch {}; Start-Sleep -Milliseconds 700 }; if ($ready) { exit 0 } else { exit 1 }"
if errorlevel 1 (
    echo The server did not become ready in time.
    echo Check the server console window for details.
    if exist "%PID_FILE%" del /q "%PID_FILE%" >nul 2>nul
    goto :fail
)

echo Opening:
echo   %APP_URL%
start "" "%APP_URL%"
goto :end

:fail
echo.
echo Startup could not continue.
echo No saved tasks or database files were changed.
pause

:end
popd
endlocal
