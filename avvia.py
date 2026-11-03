"""Avviatore di BudgetApp (lo usano gli installatori): tiene acceso il server e gestisce gli aggiornamenti automatici.

Uso:  uv run python avvia.py --host 0.0.0.0 --port 8765

- Se il server esce con il codice RIAVVIA (dopo aver installato una versione nuova) lo riaccende subito.
- Se una versione appena installata si spegne entro PROVA secondi, rimette la versione precedente
  (copia in data/update/precedente) e segna quella nuova come "fallita", così non viene riprovata.
- Usa solo la libreria standard: deve funzionare anche se il codice nuovo dell'app è rotto.
  Questo file NON viene sostituito dagli aggiornamenti automatici (cambia solo reinstallando).
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get("BUDGET_DATA", ROOT / "data"))
STATE = DATA / "update.json"
BACKUP = DATA / "update" / "precedente"
RIAVVIA = 75   # codice d'uscita del server dopo un aggiornamento
PROVA = 90     # secondi: se la versione nuova regge così a lungo, va bene


def log(msg: str) -> None:
    print(time.strftime("%d/%m %H:%M:%S"), "[avvio]", msg, flush=True)


def read_state() -> dict:
    try:
        return json.loads(STATE.read_text())
    except (OSError, ValueError):
        return {}


def write_state(state: dict) -> None:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=1))
    tmp.replace(STATE)


def rollback(state: dict) -> None:
    """Rimette i file salvati prima dell'aggiornamento (stessa lista che l'aggiornatore ha copiato)."""
    if not BACKUP.is_dir():
        log("versione nuova non partita, ma manca la copia precedente: resto così")
        return
    for item in BACKUP.iterdir():
        dest = ROOT / item.name
        if dest.is_dir():
            shutil.rmtree(dest)
        elif dest.exists():
            dest.unlink()
        (shutil.copytree if item.is_dir() else shutil.copy2)(item, dest)
    state.update(failed=state.get("installed"), installed=state.get("previous"), pending=False,
                 result=f"la versione nuova non partiva: rimessa quella di prima ({time.strftime('%d/%m %H:%M')})")
    write_state(state)
    log("versione nuova non partita: rimessa quella di prima")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", default="8765")
    args = ap.parse_args()
    os.chdir(ROOT)
    env = {**os.environ, "BUDGET_LAUNCHER": "1"}  # il server sa che può riavviarsi da solo
    fails = 0
    while True:
        started = time.time()
        proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "server.main:app", "--host", args.host, "--port", args.port], env=env)
        confirmed = False
        while proc.poll() is None:
            time.sleep(2)
            state = read_state()
            if not confirmed and state.get("pending") and time.time() - started > PROVA:
                state.update(pending=False, result=f"aggiornata il {time.strftime('%d/%m alle %H:%M')}")
                write_state(state)
                confirmed = True
                log("versione nuova partita bene")
        code = proc.returncode
        if code == RIAVVIA:
            log("riavvio con la versione nuova")
            continue
        state = read_state()
        if state.get("pending") and time.time() - started < PROVA:
            rollback(state)
            continue
        if code == 0:
            return  # spento di proposito
        fails = fails + 1 if time.time() - started < 30 else 0
        log(f"il server si è fermato (codice {code}): lo riaccendo")
        time.sleep(min(60, 3 * fails + 2))


if __name__ == "__main__":
    main()
