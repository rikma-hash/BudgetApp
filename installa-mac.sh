#!/bin/bash
# Installatore di BudgetApp per Mac.
# Uso: apri il Terminale nella cartella di BudgetApp e scrivi:   bash installa-mac.sh
# Cosa fa: installa uv (se manca), prepara il tuo file Excel dal modello vuoto (mai sovrascrive un file esistente),
# avvia l'app in automatico all'accensione del Mac e, se c'è Tailscale, la rende raggiungibile dall'iPhone.
# Si può rilanciare quando vuoi (per esempio dopo aver scaricato una versione nuova).
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${BUDGETAPP_PORT:-8765}"
LABEL="${BUDGETAPP_LABEL:-com.budgetapp.server}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
UV="$HOME/.local/bin/uv"
TS="/Applications/Tailscale.app/Contents/MacOS/Tailscale"

ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }
info() { printf "  • %s\n" "$1"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$1"; }
ask()  { local a; read -r -p "  $1 [s/n] " a; [[ "$a" =~ ^[sSyY] ]]; }

echo
echo "💶 Installazione di BudgetApp"
echo "   cartella: $APP_DIR"
echo

[[ "$(uname)" == "Darwin" ]] || { echo "Questo installatore è per Mac. Su Windows usa installa-windows.ps1"; exit 1; }
[[ -f "$APP_DIR/server/main.py" && -f "$APP_DIR/modello/Budget_Tracker_vuoto.xlsx" ]] || {
  echo "Non trovo i file dell'app: lancia lo script dalla cartella di BudgetApp."; exit 1; }

# 1) uv (porta con sé Python)
echo "1/4  Programmi necessari"
if [[ -x "$UV" ]] || command -v uv >/dev/null 2>&1; then
  [[ -x "$UV" ]] || UV="$(command -v uv)"
  ok "uv è già installato"
else
  info "Installo uv (programma gratuito che fa girare l'app, da astral.sh)…"
  curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null
  [[ -x "$UV" ]] || UV="$(command -v uv)"
  ok "uv installato"
fi
(cd "$APP_DIR" && "$UV" sync -q) && ok "componenti dell'app pronti"

# 2) il file Excel del budget
echo
echo "2/4  Il tuo file Excel"
ICLOUD="$HOME/Library/Mobile Documents/com~apple~CloudDocs"
if [[ -n "${BUDGETAPP_XLSX:-}" ]]; then
  XLSX="$BUDGETAPP_XLSX"
elif [[ -f "$PLIST" ]] && grep -q BUDGET_XLSX "$PLIST"; then
  XLSX="$(/usr/libexec/PlistBuddy -c 'Print :EnvironmentVariables:BUDGET_XLSX' "$PLIST" 2>/dev/null || true)"
fi
if [[ -z "${XLSX:-}" ]]; then
  if [[ -d "$ICLOUD" ]]; then DEF="$ICLOUD/BudgetApp/Budget.xlsx"; else DEF="$HOME/Documents/BudgetApp-dati/Budget.xlsx"; fi
  info "Dove vuoi tenere il file? Premi Invio per: ${DEF/#$HOME/~}"
  read -r -p "  percorso: " XLSX
  XLSX="${XLSX:-$DEF}"
  XLSX="${XLSX/#\~/$HOME}"
fi
if [[ -f "$XLSX" ]]; then
  ok "uso il file che c'è già: ${XLSX/#$HOME/~} (non lo tocco)"
else
  mkdir -p "$(dirname "$XLSX")"
  cp "$APP_DIR/modello/Budget_Tracker_vuoto.xlsx" "$XLSX"
  ok "creato dal modello vuoto: ${XLSX/#$HOME/~}"
fi

# 3) avvio automatico (launchd)
echo
echo "3/4  Avvio automatico"
if [[ -f "$PLIST" ]] && ! grep -q "$APP_DIR" "$PLIST"; then
  warn "C'è già un avvio automatico di BudgetApp che punta a un'altra cartella."
  ask "Lo sostituisco con questa?" || { echo "  Ok, lascio com'è. Fine."; exit 0; }
fi
mkdir -p "$APP_DIR/logs" "$HOME/Library/LaunchAgents"
xml() { local s="$1"; s="${s//&/&amp;}"; s="${s//</&lt;}"; printf '%s' "${s//>/&gt;}"; }
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml "$UV")</string><string>run</string><string>--directory</string><string>$(xml "$APP_DIR")</string>
    <string>uvicorn</string><string>server.main:app</string><string>--host</string><string>0.0.0.0</string>
    <string>--port</string><string>$PORT</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>BUDGET_XLSX</key><string>$(xml "$XLSX")</string>
    <key>BUDGET_AI</key><string>cli</string>
    <key>PYTHONUNBUFFERED</key><string>1</string>
    <key>PATH</key><string>$(xml "$(dirname "$UV")"):/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>WorkingDirectory</key><string>$(xml "$APP_DIR")</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$(xml "$APP_DIR/logs/server.log")</string>
  <key>StandardErrorPath</key><string>$(xml "$APP_DIR/logs/server.log")</string>
</dict>
</plist>
PL
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
for _ in $(seq 1 20); do
  curl -s -o /dev/null "http://127.0.0.1:$PORT/api/state" && break
  sleep 1
done
if curl -s -o /dev/null "http://127.0.0.1:$PORT/api/state"; then
  ok "l'app è accesa e partirà da sola a ogni accensione del Mac"
else
  warn "l'app non risponde: guarda $APP_DIR/logs/server.log"; exit 1
fi

# 4) iPhone (Tailscale)
echo
echo "4/4  Collegamento con l'iPhone"
PHONE_URL=""
if [[ -x "$TS" ]] && "$TS" status >/dev/null 2>&1; then
  NAME="$("$TS" status --json 2>/dev/null | /usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))' 2>/dev/null || true)"
  if [[ "$PORT" == "8765" ]] && "$TS" serve --bg "$PORT" >/dev/null 2>&1; then
    PHONE_URL="https://$NAME"
    ok "Tailscale pronto"
  else
    IP="$("$TS" ip -4 2>/dev/null | head -1)"
    PHONE_URL="http://$IP:$PORT"
    if [[ "$PORT" == "8765" ]]; then
      warn "indirizzo sicuro (https) non attivo: nella console di Tailscale attiva MagicDNS e HTTPS (vedi la guida), poi rilancia lo script"
    else
      warn "porta $PORT: l'indirizzo sicuro (https) si imposta solo con la porta normale 8765"
    fi
  fi
else
  warn "Tailscale non è installato o non è acceso: installalo (tailscale.com/download), fai il login e rilancia lo script"
fi

echo
echo "✅ Fatto!"
echo "   Sul Mac apri:      http://127.0.0.1:$PORT"
[[ -n "$PHONE_URL" ]] && echo "   Sull'iPhone apri:  $PHONE_URL   (con Tailscale acceso, poi Condividi › Aggiungi alla schermata Home)"
echo "   Il tuo file Excel: ${XLSX/#$HOME/~}"
echo
