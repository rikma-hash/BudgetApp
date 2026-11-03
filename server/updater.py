"""Aggiornamenti automatici per chi ha installato l'app dallo ZIP di GitHub (gli amici).

Ogni tanto chiede a GitHub l'ultima versione del ramo `stabile`; se è nuova scarica lo ZIP di quella versione,
sostituisce solo il codice (MANAGED_DIRS / MANAGED_FILES), tiene una copia di prima in data/update/precedente e
fa riavviare il server (avvia.py lo riaccende; se la versione nuova non parte, rimette la copia di prima).
Non tocca mai: file Excel, data/, backups/, logs/, .venv, avvia.py.

Spento quando: la cartella è un clone git (chi sviluppa: le modifiche locali non vanno perse), il server non è
partito da avvia.py (avvio vecchio: non saprebbe riaccendersi), BUDGET_AUTOUPDATE=off, o l'utente l'ha spento
nelle Impostazioni (profile.json › auto_update = false).
"""

from __future__ import annotations

import datetime as dt
import io
import json
import os
import shutil
import subprocess
import urllib.request
import zipfile
from pathlib import Path

REPO = os.environ.get("BUDGET_UPDATE_REPO", "rikma-hash/BudgetApp")
# gli amici ricevono solo quello che viene pubblicato su questo ramo (non ogni modifica di main); la variabile serve per le prove
BRANCH = os.environ.get("BUDGET_UPDATE_BRANCH", "stabile")
MANAGED_DIRS = ["server", "web", "scripts", "modello", "docs", "launchd"]
MANAGED_FILES = ["README.md", "GUIDA.md", "LICENSE", "pyproject.toml", "uv.lock", "installa-mac.sh", "installa-windows.ps1"]
RESTART_CODE = 75    # lo stesso di avvia.py
UA = {"User-Agent": "BudgetApp-aggiornamenti"}


class Updater:
    def __init__(self, root: Path, data: Path):
        self.root, self.data = root, data
        self.state_file = data / "update.json"
        self.work = data / "update"

    # ---------- stato ----------

    def state(self) -> dict:
        try:
            return json.loads(self.state_file.read_text())
        except (OSError, ValueError):
            return {}

    def _save(self, **changes) -> dict:
        st = {**self.state(), **changes}
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.state_file.with_suffix(".tmp")
        tmp.write_text(json.dumps(st, indent=1))
        tmp.replace(self.state_file)
        return st

    def blocked(self, profile: dict) -> str | None:
        """Perché gli aggiornamenti automatici sono spenti (None = accesi)."""
        if (self.root / ".git").exists():
            return "dev"       # copia collegata a GitHub: si aggiorna con git, non da qui
        if os.environ.get("BUDGET_AUTOUPDATE", "").lower() == "off":
            return "off"
        if profile.get("auto_update") is False:
            return "off"
        if os.environ.get("BUDGET_LAUNCHER") != "1":
            return "old"       # avviata senza avvia.py: va rilanciato l'installatore una volta
        return None

    def status(self, profile: dict) -> dict:
        st = self.state()
        return {"blocked": self.blocked(profile), "installed": (st.get("installed") or "")[:7] or None,
                "last_check": st.get("last_check"), "result": st.get("result"), "branch": BRANCH}

    # ---------- GitHub ----------

    def latest(self) -> str:
        req = urllib.request.Request(f"https://api.github.com/repos/{REPO}/commits/{BRANCH}",
                                     headers={**UA, "Accept": "application/vnd.github.sha"})
        with urllib.request.urlopen(req, timeout=20) as r:
            sha = r.read().decode().strip()
        if len(sha) != 40:
            raise ValueError("risposta strana da GitHub")
        return sha

    def check(self, profile: dict, force: bool = False) -> dict:
        """Controlla e, se c'è una versione nuova, la installa. Restituisce {"updated": bool, ...}."""
        why = self.blocked(profile)
        if why:
            return {"updated": False, "blocked": why}
        st = self.state()
        sha = self.latest()
        now = dt.datetime.now().strftime("%Y-%m-%d %H:%M")
        if sha == st.get("installed") or (sha == st.get("failed") and not force):
            self._save(last_check=now)
            return {"updated": False, "latest": sha[:7]}
        self.install(sha)
        self._save(last_check=now)
        return {"updated": True, "latest": sha[:7]}

    # ---------- installazione ----------

    def install(self, sha: str) -> None:
        with urllib.request.urlopen(urllib.request.Request(f"https://codeload.github.com/{REPO}/zip/{sha}", headers=UA), timeout=120) as r:
            blob = r.read()
        new = self.work / "nuova"
        shutil.rmtree(new, ignore_errors=True)
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            z.extractall(new)
        tops = [p for p in new.iterdir() if p.is_dir()]
        src = tops[0] if len(tops) == 1 else new
        if not (src / "server" / "main.py").is_file() or not (src / "web" / "index.html").is_file():
            raise ValueError("lo ZIP scaricato non sembra BudgetApp")

        # copia di quello che c'è ora (per tornare indietro)
        backup = self.work / "precedente"
        shutil.rmtree(backup, ignore_errors=True)
        backup.mkdir(parents=True)
        for name in MANAGED_DIRS + MANAGED_FILES:
            cur = self.root / name
            if cur.is_dir():
                shutil.copytree(cur, backup / name, ignore=shutil.ignore_patterns("__pycache__"))
            elif cur.is_file():
                shutil.copy2(cur, backup / name)

        deps_changed = any(not (self.root / f).is_file() or (self.root / f).read_bytes() != (src / f).read_bytes()
                           for f in ("pyproject.toml", "uv.lock") if (src / f).is_file())
        try:
            for name in MANAGED_DIRS + MANAGED_FILES:
                s, d = src / name, self.root / name
                if s.is_dir():
                    shutil.rmtree(d, ignore_errors=True)
                    shutil.copytree(s, d)
                elif s.is_file():
                    shutil.copy2(s, d)
            if deps_changed:
                self._uv_sync()
        except Exception:
            self._restore(backup)
            raise
        finally:
            shutil.rmtree(new, ignore_errors=True)
        st = self.state()
        self._save(previous=st.get("installed"), installed=sha, pending=True,
                   result=f"installata {sha[:7]} il {dt.datetime.now():%d/%m alle %H:%M}: riavvio")

    def _uv_sync(self) -> None:
        uv = os.environ.get("UV") or shutil.which("uv")
        if not uv:
            home = Path.home() / ".local" / "bin"
            uv = next((str(p) for p in (home / "uv", home / "uv.exe") if p.is_file()), None)
        if not uv:
            raise RuntimeError("non trovo uv per installare i componenti nuovi")
        subprocess.run([uv, "sync", "-q"], cwd=self.root, check=True, timeout=600)

    def _restore(self, backup: Path) -> None:
        for item in backup.iterdir():
            d = self.root / item.name
            if d.is_dir():
                shutil.rmtree(d, ignore_errors=True)
            elif d.exists():
                d.unlink()
            (shutil.copytree if item.is_dir() else shutil.copy2)(item, d)
