@echo off
title 3D VFD Virtual Lab Server
echo ========================================================
echo        3D VFD & INDUCTION MOTOR VIRTUAL LAB
echo ========================================================
echo Starting local web server on port 8000...
echo.
echo Open your browser and navigate to:
echo http://localhost:8000
echo.
echo Press Ctrl+C in this window to stop the server.
echo ========================================================
python -m http.server 8000
pause
