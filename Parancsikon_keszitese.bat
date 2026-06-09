@echo off
rem ============================================================
rem  Asztali parancsikon letrehozasa a Hutestechnika AI ind.
rem  Futtasd dupla kattintassal. Egyszer kell csak lefuttatni.
rem ============================================================

set "TARGET=%~dp0start.html"
set "ICON=%~dp0icon.ico"

echo Parancsikon letrehozasa az asztalon...

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$desktop=[Environment]::GetFolderPath('Desktop');" ^
  "$lnk=Join-Path $desktop 'Hutestechnika AI.lnk';" ^
  "$ws=New-Object -ComObject WScript.Shell;" ^
  "$s=$ws.CreateShortcut($lnk);" ^
  "$s.TargetPath='%TARGET%';" ^
  "$s.WorkingDirectory='%~dp0';" ^
  "if (Test-Path '%ICON%') { $s.IconLocation='%ICON%' };" ^
  "$s.Save();"

echo.
echo KESZ! A parancsikon az asztalon: "Hutestechnika AI"
echo Dupla kattintassal megnyilik a valaszto felulet.
echo.
pause
