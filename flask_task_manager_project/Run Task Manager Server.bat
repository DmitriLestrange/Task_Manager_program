@echo off
setlocal ENABLEEXTENSIONS

pushd "%~dp0"
title Task Manager Server

if exist ".venv\Scripts\activate.bat" (
    call ".venv\Scripts\activate.bat"
) else (
    if exist "venv\Scripts\activate.bat" (
        call "venv\Scripts\activate.bat"
    )
)

where py >nul 2>nul
if not errorlevel 1 (
    py -3 app.py
    goto :end
)

where python >nul 2>nul
if not errorlevel 1 (
    python app.py
    goto :end
)

echo Python was not found on this computer.
echo Install Python 3 and try again.
pause

:end
popd
endlocal
