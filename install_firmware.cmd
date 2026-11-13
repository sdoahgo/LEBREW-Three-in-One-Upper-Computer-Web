@echo off
cd /d "%~dp0"
set "FUSION_PYTHON=D:\software\ESP-IDF\Tool\python_env\idf5.5_py3.11_env\Scripts\python.exe"
if not exist "%FUSION_PYTHON%" (
  echo ESP-IDF Python not found. Run install_firmware.py with Python and esptool 4.x.
  pause
  exit /b 1
)
"%FUSION_PYTHON%" install_firmware.py %*
pause
