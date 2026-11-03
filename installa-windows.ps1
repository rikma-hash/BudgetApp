# Installatore di BudgetApp per Windows.
# Uso: tasto destro sul file > "Esegui con PowerShell"   oppure, in PowerShell nella cartella di BudgetApp:
#      powershell -ExecutionPolicy Bypass -File installa-windows.ps1
# Cosa fa: installa uv (se manca), prepara il tuo file Excel dal modello vuoto (mai sovrascrive un file esistente),
# avvia l'app in automatico quando entri in Windows e, se c'è Tailscale, la rende raggiungibile dall'iPhone.
# Si può rilanciare quando vuoi. Dopo l'installazione l'app si aggiorna da sola (avvia.py + server/updater.py).
$ErrorActionPreference = "Stop"

$AppDir = $PSScriptRoot
$Port = 8765
$Task = "BudgetApp"
function Ok($t)   { Write-Host "  [OK] $t" -ForegroundColor Green }
function Info($t) { Write-Host "  - $t" }
function Warn($t) { Write-Host "  [!] $t" -ForegroundColor Yellow }

Write-Host ""
Write-Host "Installazione di BudgetApp"
Write-Host "   cartella: $AppDir"
Write-Host ""
if (-not (Test-Path "$AppDir\server\main.py") -or -not (Test-Path "$AppDir\modello\Budget_Tracker_vuoto.xlsx")) {
  Write-Host "Non trovo i file dell'app: lancia lo script dalla cartella di BudgetApp."; exit 1
}

# 1) uv (porta con sé Python)
Write-Host "1/4  Programmi necessari"
$Uv = "$env:USERPROFILE\.local\bin\uv.exe"
if (-not (Test-Path $Uv)) { $c = Get-Command uv -ErrorAction SilentlyContinue; if ($c) { $Uv = $c.Source } }
if (-not (Test-Path $Uv)) {
  Info "Installo uv (programma gratuito che fa girare l'app, da astral.sh)..."
  powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex" | Out-Null
  $Uv = "$env:USERPROFILE\.local\bin\uv.exe"
}
Ok "uv pronto"
Push-Location $AppDir; & $Uv sync -q; Pop-Location
Ok "componenti dell'app pronti"

# 2) il file Excel del budget
Write-Host ""
Write-Host "2/4  Il tuo file Excel"
$Cfg = "$AppDir\data\percorso_excel.txt"   # dove l'ho messo l'ultima volta (resta sul tuo computer)
if (Test-Path $Cfg) { $Xlsx = (Get-Content $Cfg -Raw).Trim() } else {
  if (Test-Path "$env:USERPROFILE\iCloudDrive") { $Def = "$env:USERPROFILE\iCloudDrive\BudgetApp\Budget.xlsx" }
  elseif ($env:OneDrive) { $Def = "$env:OneDrive\BudgetApp\Budget.xlsx" }
  else { $Def = "$env:USERPROFILE\Documents\BudgetApp-dati\Budget.xlsx" }
  Info "Dove vuoi tenere il file? Premi Invio per: $Def"
  $Xlsx = Read-Host "  percorso"
  if (-not $Xlsx) { $Xlsx = $Def }
}
if (Test-Path $Xlsx) { Ok "uso il file che c'e' gia': $Xlsx (non lo tocco)" } else {
  New-Item -ItemType Directory -Force -Path (Split-Path $Xlsx) | Out-Null
  Copy-Item "$AppDir\modello\Budget_Tracker_vuoto.xlsx" $Xlsx
  Ok "creato dal modello vuoto: $Xlsx"
}
New-Item -ItemType Directory -Force -Path "$AppDir\data", "$AppDir\logs" | Out-Null
[System.IO.File]::WriteAllText($Cfg, $Xlsx, (New-Object System.Text.UTF8Encoding $false))

# 3) avvio automatico (Utilità di pianificazione), senza finestre
Write-Host ""
Write-Host "3/4  Avvio automatico"
$Cmd = "$AppDir\avvia-budgetapp.cmd"
$CmdText = @"
@echo off
chcp 65001 >nul
set "BUDGET_XLSX=$Xlsx"
set "BUDGET_AI=cli"
set "PYTHONUNBUFFERED=1"
cd /d "$AppDir"
"$Uv" run python avvia.py --host 127.0.0.1 --port $Port >> "$AppDir\logs\server.log" 2>&1
"@
$Utf8 = New-Object System.Text.UTF8Encoding $false   # senza BOM: il .cmd con BOM non parte bene
[System.IO.File]::WriteAllText($Cmd, $CmdText, $Utf8)
$Vbs = "$AppDir\avvia-budgetapp.vbs"   # lancia il .cmd nascosto (niente finestra nera)
"CreateObject(""WScript.Shell"").Run """"""$Cmd"""""", 0, False" | Set-Content -Path $Vbs -Encoding ASCII
$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$Vbs`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $Task -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Get-Process -Name uvicorn, python -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*BudgetApp*" } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName $Task
$up = $false
for ($i = 0; $i -lt 30 -and -not $up; $i++) {
  Start-Sleep 1
  try { Invoke-WebRequest "http://127.0.0.1:$Port/api/state" -UseBasicParsing -TimeoutSec 2 | Out-Null; $up = $true } catch {}
}
if ($up) { Ok "l'app e' accesa e partira' da sola ogni volta che entri in Windows" }
else { Warn "l'app non risponde: guarda $AppDir\logs\server.log"; exit 1 }

# 4) iPhone (Tailscale)
Write-Host ""
Write-Host "4/4  Collegamento con l'iPhone"
$Ts = "C:\Program Files\Tailscale\tailscale.exe"
$PhoneUrl = $null
if (Test-Path $Ts) {
  try {
    & $Ts serve --bg $Port | Out-Null
    $name = ((& $Ts status --json) | ConvertFrom-Json).Self.DNSName.TrimEnd(".")
    $PhoneUrl = "https://$name"
    Ok "Tailscale pronto"
  } catch { Warn "indirizzo sicuro (https) non attivo: nella console di Tailscale attiva MagicDNS e HTTPS (vedi la guida), poi rilancia lo script" }
} else { Warn "Tailscale non e' installato: installalo (tailscale.com/download), fai il login e rilancia lo script" }

Write-Host ""
Write-Host "Fatto!" -ForegroundColor Green
Write-Host "   Sul computer apri:  http://127.0.0.1:$Port"
if ($PhoneUrl) { Write-Host "   Sull'iPhone apri:   $PhoneUrl   (con Tailscale acceso, poi Condividi > Aggiungi alla schermata Home)" }
Write-Host "   Il tuo file Excel:  $Xlsx"
Write-Host ""
Read-Host "Premi Invio per chiudere"
