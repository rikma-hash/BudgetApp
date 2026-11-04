"""Server locale della mini-app spese.

Avvio:  uv run uvicorn server.main:app --host 0.0.0.0 --port 8765
Variabili:  BUDGET_XLSX (percorso del file), BUDGET_AI (cli|api|off)
"""

from __future__ import annotations

import datetime as dt
import ipaddress
import json
import re
import os
import subprocess
import sys
import threading
import time
from typing import Any
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import advisor
from . import importer
from . import excel as X
from . import trips as T
from .updater import Updater, RESTART_CODE
from .suggest import Suggester, ask_text, claude_cli, AI_MODE, context as user_context

ROOT = Path(__file__).resolve().parent.parent
XLSX = Path(os.environ.get("BUDGET_XLSX", ROOT / "test" / "Budget_copia.xlsx")).expanduser()
DATA = Path(os.environ.get("BUDGET_DATA", ROOT / "data"))
BACKUPS = Path(os.environ.get("BUDGET_BACKUPS", ROOT / "backups"))
PENDING = DATA / "pending.json"
DONE = DATA / "done_ids.json"

lock = threading.RLock()
updater = Updater(ROOT, DATA)
suggester = Suggester(DATA / "learned.json")
_cache: dict = {"mtime": None, "wb": None}


def _read_json(path: Path, default):
    return json.loads(path.read_text()) if path.exists() else default


def _write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=1))
    tmp.replace(path)


def workbook():
    """Workbook in cache, ricaricato se il file è cambiato (es. modificato da Excel)."""
    mtime = XLSX.stat().st_mtime
    if _cache["mtime"] != mtime:
        wb = X.load(XLSX)
        problem = None if X.TEMPLATE in wb.sheetnames else (
            "Il file Excel sembra tornato a una versione vecchia (manca il foglio _Modello). "
            "Di solito succede quando Excel salva una copia rimasta aperta: chiudi Excel e chiedi di ripristinarlo.")
        _cache.update(mtime=mtime, wb=wb, problem=problem)
        suggester.load_history(X.history(wb), known_categories(wb))
    return _cache["wb"]


def current_sheet(wb, day: dt.date | None = None):
    ws = X.sheet_for(wb, day or dt.date.today())
    return ws if ws is not None and X.is_new_layout(ws) else None


def known_categories(wb, day: dt.date | None = None) -> list[str]:
    ws = current_sheet(wb, day) or (wb[X.TEMPLATE] if X.TEMPLATE in wb.sheetnames else None)
    if ws is None:
        return []
    return [c for c, _ in X.categories(ws)]


def _invalidate():
    _cache["mtime"] = None


def write(fn):
    """Esegue una modifica sul workbook e salva; in ogni caso la cache viene ricaricata dal file."""
    with lock:
        if X.is_locked(XLSX):
            raise HTTPException(409, "Il file è aperto in Excel sul Mac: chiudilo e riprova")
        try:
            wb = workbook()
            result = fn(wb)
            X.save(wb, XLSX, BACKUPS)
            return result
        except X.ExcelLocked:
            raise HTTPException(409, "Il file è aperto in Excel sul Mac: chiudilo e riprova")
        except X.RowChanged:
            raise HTTPException(409, "Il file è cambiato nel frattempo: ricarica e riprova")
        except (KeyError, ValueError) as err:
            raise HTTPException(400, str(err).strip("'"))
        finally:
            _invalidate()


# ---------- scrittura (con coda se Excel è aperto) ----------

class Expense(BaseModel):
    id: str
    date: dt.date
    description: str = Field(min_length=1)
    amount: float = Field(gt=0)
    category: str = Field(min_length=1)
    note: str | None = None
    new_category_budget: float | None = None  # valorizzato = "crea la categoria se manca"
    split: int = Field(default=1, ge=1, le=24)  # >1 = spesa divisa in rate uguali, una per mese


def _add_months(day: dt.date, n: int) -> dt.date:
    y, m = divmod(day.month - 1 + n, 12)
    first = dt.date(day.year + y, m + 1, 1)
    last = ((first.replace(day=28) + dt.timedelta(days=4)).replace(day=1) - dt.timedelta(days=1)).day
    return first.replace(day=min(day.day, last))


def installments(e: Expense) -> list[tuple[dt.date, str, float, str | None]]:
    """(data, descrizione, importo, nota) di ogni rata; l'ultima prende i centesimi che avanzano."""
    if e.split <= 1:
        return [(e.date, e.description.strip(), e.amount, e.note)]
    part = round(e.amount / e.split, 2)
    out = []
    for i in range(e.split):
        amount = part if i < e.split - 1 else round(e.amount - part * (e.split - 1), 2)
        note = f"Rata {i + 1} di {e.split} · totale {e.amount:.2f} €".replace(".", ",") + (f" · {e.note}" if e.note else "")
        out.append((_add_months(e.date, i), f"{e.description.strip()} ({i + 1}/{e.split})", amount, note))
    return out


def _apply(e: Expense) -> dict:
    wb = workbook()
    try:  # qualunque errore: la cache (già modificata in memoria) viene scartata
        ws, _ = X.ensure_month(wb, e.date)
        known = [c for c, _ in X.categories(ws)]
        if not X.canonical(e.category, known):
            if e.new_category_budget is None:
                raise HTTPException(400, f"Categoria '{e.category}' inesistente")
            X.add_category(wb, e.category.strip(), e.new_category_budget, ws)
        for i, (day, desc, amount, note) in enumerate(installments(e)):
            # nei mesi dopo la categoria può mancare (es. creata ora): la aggiungo senza budget
            X.ensure_category(wb, X.ensure_month(wb, day)[0], e.category.strip())
            r = X.append_expense(wb, day, desc, amount, e.category, note)
            info = r if i == 0 else info
        info = {**info, "split": e.split}
        X.save(wb, XLSX, BACKUPS)
    finally:
        _invalidate()
    suggester.learn(e.description, info["category"])
    return info


def _flush_pending() -> int:
    with lock:
        pending = _read_json(PENDING, [])
        if not pending or X.is_locked(XLSX):
            return len(pending)
        done = set(_read_json(DONE, []))
        left = []
        for raw in pending:
            e = Expense(**raw)
            if e.id in done:
                continue
            try:
                _apply(e)
                done.add(e.id)
            except X.ExcelLocked:
                left.append(raw)
            except Exception as err:  # spesa non valida: la teniamo da parte per non perderla
                raw["error"] = str(err)
                _write_json(DATA / "failed.json", _read_json(DATA / "failed.json", []) + [raw])
        _write_json(PENDING, left)
        _write_json(DONE, sorted(done)[-2000:])
        return len(left)


def _auto_names() -> set[str] | None:
    """Abbonamenti da inserire in automatico (nomi in minuscolo). Nel profilo: lista di nomi; True = tutti."""
    v = _read_json(PROFILE, {}).get("auto_subs", [])
    if v is True:
        return None
    return {str(n).casefold() for n in v} if isinstance(v, list) else set()


def _auto_subscriptions() -> list[dict]:
    """Abbonamenti programmati scelti dall'utente → spese del mese, quando arriva il loro giorno."""
    only = _auto_names()
    if only is not None and not only:
        return []
    with lock:
        if X.is_locked(XLSX):
            return []
        wb = workbook()
        ws = X.sheet_for(wb, dt.date.today())
        today = dt.date.today()
        if ws is None or not any(not s["done"] and s["day"] <= today.day and (only is None or s["name"].casefold() in only)
                                 for s in X.subscriptions(ws)):
            return []  # niente da fare: non tocco il file
        added = write(lambda w: X.apply_subscriptions(w, today, only))
    if added:
        print("abbonamenti inseriti:", added)
        log = _read_json(DATA / "subs_log.json", [])
        _write_json(DATA / "subs_log.json", (log + added)[-50:])
    return added


def _update_and_restart(force: bool = False) -> dict:
    """Controlla GitHub; se ha installato una versione nuova, spegne il server (avvia.py lo riaccende)."""
    with lock:  # niente scritture sul file Excel a metà aggiornamento
        r = updater.check(_read_json(PROFILE, {}), force)
    if r.get("updated"):
        print("aggiornamento installato:", r["latest"], "· riavvio")
        threading.Timer(1.5, lambda: os._exit(RESTART_CODE)).start()  # il tempo di rispondere all'app
    return r


def _worker():
    last_subs = 0.0
    next_update = time.time() + 120  # primo controllo 2 minuti dopo l'avvio, poi ogni 6 ore
    while True:
        try:
            for p in X.snapshot(XLSX, BACKUPS, dt.date.today()):
                print("copia di sicurezza:", p.name)
        except Exception as err:
            print("copia di sicurezza:", err)
        try:
            _flush_pending()
        except Exception as err:
            print("flush:", err)
        if time.time() - last_subs > 1800:  # ogni mezz'ora
            last_subs = time.time()
            try:
                _auto_subscriptions()
            except Exception as err:
                print("abbonamenti:", err)
        if time.time() > next_update:
            next_update = time.time() + 6 * 3600
            try:
                _update_and_restart()
            except Exception as err:
                print("aggiornamento:", err)
                updater._save(result=f"controllo non riuscito ({dt.datetime.now():%d/%m %H:%M}): {str(err)[:120]}")
        time.sleep(20)


# ---------- API ----------

app = FastAPI(title="Budget")

# Il server ascolta su tutte le interfacce, ma risponde solo al Mac stesso e ai dispositivi Tailscale
ALLOWED_NETS = [ipaddress.ip_network(n) for n in ("127.0.0.0/8", "::1/128", "100.64.0.0/10", "fd7a:115c:a1e0::/48")]


@app.middleware("http")
async def only_tailnet(request: Request, call_next):
    try:
        ip = ipaddress.ip_address(request.client.host if request.client else "")
    except ValueError:
        return PlainTextResponse("Accesso consentito solo dalla rete Tailscale", status_code=403)
    if not any(ip in net for net in ALLOWED_NETS):
        return PlainTextResponse("Accesso consentito solo dalla rete Tailscale", status_code=403)
    response = await call_next(request)
    if not request.url.path.startswith("/api/"):
        # il telefono deve sempre ricontrollare pagina, script e stili: niente versioni vecchie mischiate
        response.headers.setdefault("Cache-Control", "no-cache")  # "/" e sw.js hanno già no-store
    return response


@app.on_event("startup")
def _start():
    threading.Thread(target=_worker, daemon=True).start()


@app.get("/api/state")
def state(day: dt.date | None = None):
    day = day or dt.date.today()
    with lock:
        wb = workbook()
        ws = current_sheet(wb, day)
        summary = X.summary(ws) if ws else {"sheet": None, "categories": [
            {"category": c, "budget": 0, "weeks": [0] * 5, "total": 0, "left": 0} for c in known_categories(wb, day)],
            "budget": 0, "total": 0}
        recent = sorted(X.transactions(ws), key=lambda t: (t["date"] or "", t["row"]), reverse=True) if ws else []
        return {
            "today": day.isoformat(),
            "week": X.week_of(day),
            "summary": summary,
            "recent": recent[:30],
            "descriptions": suggester.descriptions(),
            "pending": len(_read_json(PENDING, [])),
            "excel_open": X.is_locked(XLSX),
            "ai": {"mode": AI_MODE, "available": AI_MODE == "api" or bool(claude_cli())},
            "file": XLSX.name,
            "problem": _cache.get("problem"),
        }


class SuggestIn(BaseModel):
    description: str
    ai: bool = False
    date: dt.date | None = None


@app.post("/api/suggest")
def suggest(body: SuggestIn):
    with lock:
        known = known_categories(workbook(), body.date)
    return suggester.suggest(body.description, known, use_ai=body.ai)


@app.post("/api/expenses")
def add_expense(e: Expense):
    with lock:
        if e.id in set(_read_json(DONE, [])):
            return {"status": "duplicate"}
        if X.is_locked(XLSX):
            _write_json(PENDING, _read_json(PENDING, []) + [json.loads(e.model_dump_json())])
            return {"status": "queued", "reason": "Excel è aperto: la scrivo appena lo chiudi"}
        try:
            info = _apply(e)
        except X.ExcelLocked:
            _write_json(PENDING, _read_json(PENDING, []) + [json.loads(e.model_dump_json())])
            return {"status": "queued", "reason": "Excel è aperto: la scrivo appena lo chiudi"}
        _write_json(DONE, sorted(set(_read_json(DONE, [])) | {e.id})[-2000:])
        return {"status": "saved", **info}


class BudgetIn(BaseModel):
    category: str
    budget: float = Field(ge=0)
    date: dt.date | None = None


@app.put("/api/budget")
def set_budget(body: BudgetIn):
    def change(wb):
        ws, _ = X.ensure_month(wb, body.date or dt.date.today())
        X.set_budget(ws, body.category, body.budget)
    write(change)
    return {"status": "ok"}


# ---------- storico mesi ----------

def _first_of_next_month(day: dt.date) -> dt.date:
    return (day.replace(day=28) + dt.timedelta(days=4)).replace(day=1)


@app.get("/api/months")
def months():
    with lock:
        wb = workbook()
        today = dt.date.today()
        cur = X.sheet_for(wb, today)
        nxt = _first_of_next_month(today)
        nxt_sheet = X.sheet_for(wb, nxt)
        future = {m["sheet"] for m in X.year(wb)["months"] if m["future"]}
        return {
            "months": [{"sheet": ws.title, "editable": X.is_new_layout(ws), "future": ws.title in future}
                       for ws in X.month_sheets(wb)],
            "current": cur.title if cur is not None else None,
            "this": {"label": X.MONTHS[today.month - 1], "date": today.isoformat()},  # per un file nuovo senza mesi
            "next": {"sheet": nxt_sheet.title if nxt_sheet is not None else None,
                     "label": X.MONTHS[nxt.month - 1], "date": nxt.isoformat()},
        }


@app.get("/api/month")
def month(sheet: str):
    with lock:
        wb = workbook()
        if sheet not in wb.sheetnames or not X.header_row(wb[sheet]):
            raise HTTPException(404, "Mese non trovato")
        ws = wb[sheet]
        txs = sorted(X.transactions(ws), key=lambda t: (t["date"] or "", t["row"]), reverse=True)
        return {"summary": X.summary(ws), "transactions": txs,
                "categories": [c for c, _ in X.budget_table(ws)]}


@app.get("/api/year")
def year():
    with lock:
        return X.year(workbook())


# ---------- modifica spese ----------

class Expect(BaseModel):
    description: str
    amount: float


class EditIn(BaseModel):
    sheet: str
    row: int
    expect: Expect
    date: dt.date | None = None
    description: str = Field(min_length=1)
    amount: float = Field(gt=0)
    category: str = Field(min_length=1)
    note: str | None = None


class DeleteIn(BaseModel):
    sheet: str
    row: int
    expect: Expect


@app.post("/api/expenses/edit")
def edit_expense(body: EditIn):
    info = write(lambda wb: X.update_expense(wb, body.sheet, body.row, body.expect.model_dump(), body.date,
                                             body.description.strip(), body.amount, body.category, body.note))
    suggester.learn(body.description, info["category"])
    return {"status": "saved", **info}


@app.post("/api/expenses/delete")
def delete_expense(body: DeleteIn):
    write(lambda wb: X.delete_expense(wb, body.sheet, body.row, body.expect.model_dump()))
    return {"status": "deleted"}


# ---------- budget assistito ----------

@app.get("/api/budget/proposal")
def proposal(sheet: str | None = None, date: dt.date | None = None, save_rate: float = 0.1, use_carry: bool = False):
    with lock:
        if sheet:
            wb = workbook()
            if sheet not in wb.sheetnames:
                raise HTTPException(404, "Mese non trovato")
        else:
            # mese non ancora creato: lo creo su una copia in memoria, senza salvare
            wb = X.load(XLSX)
            sheet = X.ensure_month(wb, date or dt.date.today())[0].title
        if not X.is_new_layout(wb[sheet]):
            raise HTTPException(400, "Il budget assistito funziona dai mesi con il modello nuovo")
        return advisor.propose(wb, sheet, max(0.0, min(0.5, save_rate)), use_carry)


class BudgetsIn(BaseModel):
    sheet: str | None = None
    date: dt.date | None = None
    budgets: dict[str, float] = {}
    income: dict[str, Any] = {}  # borsa/personale/famiglia/altro, oppure items=[{name, amount}] (entrate a lista)
    apply_following: bool = False  # copia budget ed entrate (non il riporto) anche nei mesi successivi


@app.put("/api/budgets")
def set_budgets(body: BudgetsIn):
    def change(wb):
        ws = wb[body.sheet] if body.sheet else X.ensure_month(wb, body.date or dt.date.today())[0]
        targets = [ws]
        if body.apply_following:
            sheets = [s for s in X.month_sheets(wb) if X.is_new_layout(s)]
            targets += sheets[sheets.index(ws) + 1:]
        for i, target in enumerate(targets):
            if body.income:
                X.set_income(target, body.income if i == 0 else {k: v for k, v in body.income.items() if k != "riporto"})
            for cat, value in body.budgets.items():
                value = max(0.0, float(value))
                name = X.canonical(cat, [c for c, _ in X.categories(target)])
                if name is None:  # categoria nuova dal piano (es. "Altro")
                    X.add_category(wb, cat.strip(), value, target)
                else:
                    X.set_budget(target, name, value)
        return {"sheet": ws.title, "months": len(targets)}
    r = write(change)
    return {"status": "ok", **r}


class BudgetCopyIn(BaseModel):
    sheet: str                      # mese da cui copiare
    targets: list[str] = Field(min_length=1)
    category: str | None = None     # None = tutte le categorie del mese


@app.post("/api/budgets/copy")
def copy_budgets(body: BudgetCopyIn):
    """Copia il budget delle categorie (tutte o una) di un mese in altri mesi. Entrate e riporto non cambiano."""
    def change(wb):
        if body.sheet not in wb.sheetnames:
            raise ValueError("Mese non trovato")
        src = dict(X.categories(wb[body.sheet]))
        if body.category:
            name = X.canonical(body.category, list(src))
            if name is None:
                raise ValueError(f"Categoria '{body.category}' non trovata in {body.sheet}")
            src = {name: src[name]}
        done = []
        for t in body.targets:
            if t == body.sheet or t not in wb.sheetnames or not X.is_new_layout(wb[t]):
                continue
            ws = wb[t]
            for cat, value in src.items():
                name = X.canonical(cat, [c for c, _ in X.categories(ws)])
                if name is None:  # categoria che quel mese non ha: la aggiungo (da lì in poi, a budget 0)
                    X.add_category(wb, cat, 0.0, ws)
                    name = cat
                X.set_budget(ws, name, float(value or 0))
            done.append(t)
        if not done:
            raise ValueError("Nessun mese da aggiornare")
        return {"months": done, "categories": len(src)}
    return {"status": "ok", **write(change)}


# ---------- abbonamenti programmati ----------

@app.get("/api/subscriptions")
def subs_get(sheet: str | None = None):
    with lock:
        wb = workbook()
        ws = wb[sheet] if sheet and sheet in wb.sheetnames else (current_sheet(wb) or wb[X.TEMPLATE])
        recent = _read_json(DATA / "subs_log.json", [])[-5:]
        only = _auto_names()
        items = [{**it, "auto": only is None or it["name"].casefold() in only} for it in X.subscriptions(ws)]
        return {"sheet": ws.title if ws.title != X.TEMPLATE else None, "items": items, "recent": recent}


class SubItem(BaseModel):
    name: str = Field(min_length=1)
    amount: float = Field(gt=0)
    day: int = Field(default=1, ge=1, le=31)
    auto: bool = False  # inserirlo da solo ogni mese


class SubsIn(BaseModel):
    sheet: str | None = None
    items: list[SubItem]


@app.put("/api/subscriptions")
def subs_put(body: SubsIn):
    before = _auto_names() or set()
    turned_on = {i.name.strip().casefold() for i in body.items if i.auto} - before

    def change(wb):
        ws = wb[body.sheet] if body.sheet and body.sheet in wb.sheetnames else (current_sheet(wb) or X.ensure_month(wb, dt.date.today())[0])
        X.set_subscriptions(wb, ws, [i.model_dump(exclude={"auto"}) for i in body.items])
        # appena acceso: se nel mese in corso risulta "inserito" ma la spesa non c'è (es. eliminata), lo rimetto in lista
        cur = X.sheet_for(wb, dt.date.today())
        if cur is not None and X.is_new_layout(cur):
            txs = X.transactions(cur)
            for sub in X.subscriptions(cur):
                key = sub["name"].casefold()
                if key in turned_on and sub["done"] and not any(
                        key in (t["description"] or "").casefold() and abs(t["amount"] - sub["amount"]) < 0.01 for t in txs):
                    cur.cell(sub["row"], 10).value = False
    write(change)
    prof = _read_json(PROFILE, {})
    prof["auto_subs"] = [i.name.strip() for i in body.items if i.auto]
    _write_json(PROFILE, prof)
    added = _auto_subscriptions()
    return {"status": "ok", "added": added}


# ---------- profilo (quiz del budget) ----------

PROFILE = DATA / "profile.json"


@app.get("/api/profile")
def get_profile():
    return _read_json(PROFILE, {})


@app.put("/api/profile")
def put_profile(body: dict):
    _write_json(PROFILE, {**_read_json(PROFILE, {}), **body})
    return {"status": "ok"}


# ---------- risparmi ----------

@app.get("/api/insights")
def insights():
    with lock:
        return advisor.insights(workbook(), suggester)


@app.post("/api/advice")
def advice(lang: str = "it"):
    with lock:
        wb = workbook()
        data = advisor.insights(wb, suggester)
    data.pop("recurring", None)
    context = user_context(advisor.ADVICE_CONTEXT)
    prompt = advisor.ADVICE_PROMPT.format(context=context, data=json.dumps(data, ensure_ascii=False))
    if lang == "en":
        prompt += "\nIMPORTANTE: rispondi in inglese (English)."
    text = ask_text(prompt,
                    model="sonnet", max_tokens=700, timeout=120)
    if not text:
        raise HTTPException(503, "Claude non è disponibile (installa Claude Code e fai il login)")
    return {"text": text}


# ---------- spese frequenti ----------

@app.get("/api/quick")
def quick():
    """Le spese che fai più spesso, per inserirle con un tocco."""
    with lock:
        wb = workbook()
        txs = X.history(wb)
        known = known_categories(wb)
    groups: dict[str, list[dict]] = {}
    for t in txs[-250:]:
        groups.setdefault(t["description"].strip().casefold(), []).append(t)
    out = []
    for items in sorted(groups.values(), key=lambda g: -len(g))[:8]:
        if len(items) < 2:
            break
        amounts = sorted(i["amount"] for i in items)
        last = items[-1]
        out.append({"description": last["description"], "amount": amounts[len(amounts) // 2],
                    "category": X.canonical(last["category"] or "", known) or last["category"], "count": len(items)})
    return {"items": out}


# ---------- scatola nera dell'app (diagnosi degli avvii offline) ----------

@app.post("/api/diag")
def diag(body: dict):
    lines = [f"--- {dt.datetime.now():%Y-%m-%d %H:%M:%S} · {body.get('ua', '')[:120]} · standalone={body.get('standalone')}"]
    for src in ("app", "sw"):
        for ev in body.get(src, [])[-60:]:
            t = dt.datetime.fromtimestamp(ev.get("t", 0) / 1000).strftime("%d/%m %H:%M:%S")
            lines.append(f"{t} [{src}] {str(ev.get('m', ''))[:300]}")
    (ROOT / "logs").mkdir(exist_ok=True)
    with open(ROOT / "logs" / "diag.log", "a") as f:
        f.write("\n".join(lines) + "\n")
    return {"status": "ok"}


# ---------- pacchetto per l'uso offline ----------

@app.get("/api/offline-pack")
def offline_pack():
    """Quello che serve al telefono per suggerire la categoria anche con il Mac spento."""
    from .suggest import KEYWORDS
    with lock:
        workbook()  # carica lo storico nel suggeritore
        history = {k: c.most_common(1)[0][0] for k, c in suggester.index.items() if c}
    return {"keywords": KEYWORDS, "learned": suggester.learned, "history": history}


# ---------- viaggi ----------

@app.get("/api/trips")
def trips_list():
    with lock:
        wb = workbook()
        return {"trips": T.list_trips(wb), "ready": T.TEMPLATE in wb.sheetnames}


@app.get("/api/trip")
def trip_detail(name: str):
    with lock:
        wb = workbook()
        try:
            ws = T.get(wb, name)
        except KeyError as err:
            raise HTTPException(404, str(err).strip("'"))
        txs = sorted(T.transactions(ws), key=lambda t: (t["date"] or "", t["row"]), reverse=True)
        cats = [c for c, _ in T.categories(ws)]
        return {"summary": T.summary(ws), "transactions": txs, "categories": cats,
                "free_slots": T.MAX_CATS - len(cats)}


class TripIn(BaseModel):
    name: str = Field(min_length=1)
    budgets: dict[str, float] = {}
    note: str | None = None
    copy_from: str | None = None  # viaggio da cui copiare categorie e budget


@app.post("/api/trips")
def trip_create(body: TripIn):
    def change(wb):
        ws = T.create(wb, body.name, body.budgets, body.note)
        if body.copy_from:
            T.copy_budgets(wb, ws, T.get(wb, body.copy_from))
        return ws.title[len(T.PREFIX):]
    return {"status": "ok", "name": write(change)}


class TripName(BaseModel):
    name: str


@app.post("/api/trips/delete")
def trip_delete(body: TripName):
    write(lambda wb: T.delete(wb, body.name))
    return {"status": "deleted"}


class TripExpense(BaseModel):
    trip: str
    date: dt.date
    description: str = Field(min_length=1)
    amount: float = Field(gt=0)
    category: str = Field(min_length=1)
    note: str | None = None
    id: str | None = None
    new_category_budget: float | None = None  # valorizzato = "crea la categoria del viaggio se manca"


@app.post("/api/trips/expense")
def trip_add(body: TripExpense):
    with lock:
        if body.id and body.id in set(_read_json(DONE, [])):
            return {"status": "duplicate"}
    info = write(lambda wb: T.add_expense(wb, body.trip, body.date, body.description.strip(), body.amount,
                                          body.category, body.note, body.new_category_budget))
    if body.id:
        with lock:
            _write_json(DONE, sorted(set(_read_json(DONE, [])) | {body.id})[-2000:])
    return {"status": "saved", **info}


class TripEdit(BaseModel):
    trip: str
    row: int
    expect: Expect
    date: dt.date | None = None
    description: str = Field(min_length=1)
    amount: float = Field(gt=0)
    category: str = Field(min_length=1)
    note: str | None = None


@app.post("/api/trips/edit")
def trip_edit(body: TripEdit):
    info = write(lambda wb: T.edit_expense(wb, body.trip, body.row, body.expect.model_dump(), body.date,
                                           body.description.strip(), body.amount, body.category, body.note))
    return {"status": "saved", **info}


class TripDeleteExpense(BaseModel):
    trip: str
    row: int
    expect: Expect


@app.post("/api/trips/delete-expense")
def trip_delete_expense(body: TripDeleteExpense):
    write(lambda wb: T.delete_expense(wb, body.trip, body.row, body.expect.model_dump()))
    return {"status": "deleted"}


class TripBudget(BaseModel):
    trip: str
    category: str
    budget: float = Field(ge=0)


@app.put("/api/trips/budget")
def trip_budget(body: TripBudget):
    write(lambda wb: T.set_budget(T.get(wb, body.trip), body.category, body.budget))
    return {"status": "ok"}


class TripCategory(BaseModel):
    trip: str
    name: str = Field(min_length=1)
    budget: float = Field(ge=0, default=0)


@app.post("/api/trips/category")
def trip_category(body: TripCategory):
    name = write(lambda wb: T.add_category(wb, T.get(wb, body.trip), body.name, body.budget))
    return {"status": "ok", "name": name}


class TripCopy(BaseModel):
    trip: str
    source: str


@app.post("/api/trips/copy-budget")
def trip_copy_budget(body: TripCopy):
    if body.trip == body.source:
        raise HTTPException(400, "Scegli un altro viaggio")
    n = write(lambda wb: T.copy_budgets(wb, T.get(wb, body.trip), T.get(wb, body.source)))
    return {"status": "ok", "copied": n}


# ---------- import estratto conto (CSV / PDF) ----------

class ImportFile(BaseModel):
    filename: str
    data: str  # contenuto del file in base64


@app.post("/api/import/parse")
def import_parse(body: ImportFile):
    import base64
    try:
        raw = base64.b64decode(body.data.split(",")[-1])
    except ValueError:
        raise HTTPException(400, "File non leggibile")
    if len(raw) > 8_000_000:
        raise HTTPException(400, "File troppo grande (max 8 MB)")
    try:
        parsed = importer.parse(body.filename, raw)
    except ValueError as err:
        raise HTTPException(400, str(err))
    except Exception as err:  # PDF rovinati, codifiche strane…
        raise HTTPException(400, f"Non riesco a leggere il file ({type(err).__name__})")

    with lock:
        wb = workbook()
        existing = [t for t in X.history(wb) if t["date"] and not t.get("trip")]
        for tws in T.trip_sheets(wb):
            existing += [{**t, "sheet": "✈️ " + t["trip"]} for t in T.transactions(tws) if t["date"]]
        first_month = min((dt.date.fromisoformat(t["date"]).replace(day=1) for t in existing), default=dt.date.today())
        items = []
        for i, it in enumerate(parsed["items"]):
            day = dt.date.fromisoformat(it["date"])
            ws = X.sheet_for(wb, day)
            blocked = None
            if ws is not None and not X.is_new_layout(ws):
                blocked = f"{ws.title} è un mese vecchio: si modifica solo in Excel"
            elif ws is None and day < first_month:
                blocked = "Prima dell'inizio del budget"
            dup = next((t for t in existing if abs(t["amount"] - it["amount"]) < 0.005
                        and abs((dt.date.fromisoformat(t["date"]) - day).days) <= 2), None)
            known = known_categories(wb, day)
            sug = suggester.suggest(it["description"], known, use_ai=False)["suggestions"]
            top = sug[0] if sug else None
            items.append({**it, "i": i, "blocked": blocked,
                          "duplicate": f"{dup['description']} ({dup['sheet']})" if dup else None,
                          "category": top["category"] if top else None, "new": bool(top and top["new"]),
                          "score": round(top["score"], 2) if top else 0})
        cats = known_categories(wb)
    _ai_categories(items, cats)
    return {"items": items, "income": parsed["income"], "categories": cats}


IMPORT_PROMPT = """Sei l'assistente del budget personale di {context}. Categorie esistenti: {cats}.
Per ogni spesa (da un estratto conto) scegli la categoria più adatta tra quelle esistenti; solo se nessuna va bene
proponi un nome nuovo breve in italiano. Rispondi SOLO con JSON tipo {{"0": "Spesa", "3": "Trasporti"}}.
Spese:
{rows}"""


def _ai_categories(items: list[dict], cats: list[str]) -> None:
    """Una sola domanda a Claude per tutte le spese incerte (se l'IA è attiva); le altre restano come sono."""
    unsure = [it for it in items if not it["blocked"] and it["score"] < 0.8][:60]
    if not unsure or AI_MODE == "off":
        return
    rows = "\n".join(f'{it["i"]}: {it["description"]} ({it["original"][:60]}) {it["amount"]:.2f} €' for it in unsure)
    text = ask_text(IMPORT_PROMPT.format(context=user_context(), cats=", ".join(cats), rows=rows), max_tokens=800, timeout=90)
    m = re.search(r"\{.*\}", text or "", re.S)
    if not m:
        return
    try:
        answer = json.loads(m.group(0))
    except ValueError:
        return
    by_i = {it["i"]: it for it in unsure}
    for k, cat in answer.items():
        it = by_i.get(int(k)) if str(k).isdigit() else None
        if it and isinstance(cat, str) and cat.strip():
            canon = X.canonical(cat, cats)
            it.update(category=canon or cat.strip(), new=canon is None, score=0.85, ai=True)


class ImportItem(BaseModel):
    date: dt.date
    description: str = Field(min_length=1)
    amount: float = Field(gt=0)
    category: str = Field(min_length=1)
    note: str | None = None


class ImportSave(BaseModel):
    items: list[ImportItem]


@app.post("/api/import/save")
def import_save(body: ImportSave):
    def change(wb):
        sheets = set()
        for it in body.items:
            ws, _ = X.ensure_month(wb, it.date)
            X.ensure_category(wb, ws, it.category.strip())
            sheets.add(X.append_expense(wb, it.date, it.description.strip(), it.amount, it.category, it.note)["sheet"])
        return sorted(sheets)
    sheets = write(change)
    for it in body.items:
        suggester.learn(it.description, it.category)
    return {"status": "ok", "count": len(body.items), "sheets": sheets}


# ---------- gestione categorie ----------

@app.get("/api/categories")
def categories_list(sheet: str | None = None):
    with lock:
        wb = workbook()
        ws = wb[sheet] if sheet and sheet in wb.sheetnames else (current_sheet(wb) or wb[X.TEMPLATE])
        s = X.summary(ws)
        return {"sheet": ws.title if ws.title != X.TEMPLATE else None,
                "categories": [{"category": c["category"], "budget": c["budget"], "total": c["total"]}
                               for c in s["categories"]],
                "free_slots": X.CAT_LAST - X.CAT_FIRST + 1 - len(X.categories(ws)),
                # entrate del mese: in Categorie servono per mostrare quanto è disponibile mentre cambi un budget
                "income": X.income(ws) if X.is_new_layout(ws) else None}


class RenameIn(BaseModel):
    old: str
    new: str = Field(min_length=1)


@app.post("/api/categories/rename")
def categories_rename(body: RenameIn):
    n = write(lambda wb: X.rename_category(wb, body.old, body.new))
    suggester.rename_category(body.old, body.new.strip())
    return {"status": "ok", "changed": n}


class CatDeleteIn(BaseModel):
    name: str
    move_to: str | None = None


@app.post("/api/categories/delete")
def categories_delete(body: CatDeleteIn):
    n = write(lambda wb: X.delete_category(wb, body.name, body.move_to))
    suggester.rename_category(body.name, body.move_to) if body.move_to else None
    return {"status": "ok", "moved": n}


class CatAddIn(BaseModel):
    name: str = Field(min_length=1)
    budget: float = Field(ge=0, default=0)
    sheet: str | None = None


@app.post("/api/categories/add")
def categories_add(body: CatAddIn):
    def change(wb):
        ws = wb[body.sheet] if body.sheet else (current_sheet(wb) or X.ensure_month(wb, dt.date.today())[0])
        if X.canonical(body.name, [c for c, _ in X.categories(ws)]):
            raise ValueError(f"La categoria '{body.name}' esiste già")
        X.add_category(wb, body.name.strip(), body.budget, ws)
    write(change)
    return {"status": "ok"}


# ---------- collegamento a Excel ----------

def _is_mac(request: Request) -> bool:
    return request.headers.get("host", "").split(":")[0] in ("127.0.0.1", "localhost")


@app.get("/api/excel")
def excel_info(request: Request):
    folder = XLSX.parent
    mobile = str(folder).split("Mobile Documents/", 1)[-1] if "Mobile Documents/" in str(folder) else None
    return {
        "file": XLSX.name,
        "on_mac": _is_mac(request),
        # sull'iPhone: apre l'app File nella cartella iCloud del file
        "files_url": ("shareddocuments:///private/var/mobile/Library/Mobile%20Documents/" + mobile.replace(" ", "%20"))
        if mobile else None,
        "mtime": dt.datetime.fromtimestamp(XLSX.stat().st_mtime).isoformat(timespec="seconds"),
    }


@app.post("/api/excel/open")
def excel_open(request: Request):
    if not _is_mac(request):
        raise HTTPException(403, "Si apre solo dal Mac")
    if sys.platform == "darwin":
        subprocess.Popen(["open", str(XLSX)])
    elif os.name == "nt":  # Windows
        os.startfile(str(XLSX))  # type: ignore[attr-defined]
    else:
        subprocess.Popen(["xdg-open", str(XLSX)])
    return {"status": "ok"}


WEB = ROOT / "web"
app.mount("/static", StaticFiles(directory=WEB), name="static")


NO_STORE = {"Cache-Control": "no-store"}  # pagina e service worker: mai dalla cache di Safari


@app.get("/")
def index():
    return FileResponse(WEB / "index.html", headers=NO_STORE)


@app.get("/sw.js")
def sw():
    return FileResponse(WEB / "sw.js", media_type="application/javascript", headers=NO_STORE)


@app.get("/api/update")
def update_status():
    return updater.status(_read_json(PROFILE, {}))


@app.post("/api/update/check")
def update_check():
    try:
        return _update_and_restart(force=True)
    except Exception as err:
        raise HTTPException(502, f"Non riesco a controllare gli aggiornamenti: {str(err)[:120]}")


@app.get("/api/version")
def web_version():
    """Versione dell'app sul Mac (il ?v=N di app.js in index.html): il telefono la confronta con la sua copia."""
    m = re.search(r"app\.js\?v=(\d+)", (WEB / "index.html").read_text())
    return {"version": m.group(1) if m else None}


@app.get("/manifest.webmanifest")
def manifest():
    return FileResponse(WEB / "manifest.webmanifest", media_type="application/manifest+json")
