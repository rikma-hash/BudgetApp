"""Viaggi: un foglio per viaggio (dal template dell'utente), riepilogo nel foglio 'Viaggi'
e una riga '✈️ Viaggio: …' per ogni mese, con il totale del viaggio in quel mese.

Layout di un foglio viaggio (come il template Viaggi.xlsx):
  A1 titolo, A2 istruzioni
  A3:E3  Data | Descrizione | Importo | Categoria | Note      righe 4..503
  G3:J3  Categoria | Budget | Speso | Surplus/Deficit         righe 4..11, TOTALE riga 12
         (l'app può aggiungere categorie: la riga TOTALE scende, fino a MAX_CATS categorie)
"""

from __future__ import annotations

import datetime as dt
import re
from copy import copy

import openpyxl
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.worksheet.worksheet import Worksheet

from . import excel as X

PREFIX = "✈ "
TEMPLATE = "_ModelloViaggio"
SUMMARY = "Viaggi"
TX_FIRST, TX_LAST = 4, 503
CAT_FIRST, CAT_LAST, TOT_ROW = 4, 11, 12   # posizioni del template; nei fogli il TOTALE può essere più in basso
MAX_CATS = 20
SUM_FIRST, SUM_LAST = 4, 33          # righe del riepilogo nel foglio 'Viaggi'
LINK_PREFIX = "✈️ Viaggio: "
LINK_CATEGORY = "Viaggi"

LINK_RE = re.compile(r"^=SUMIFS\('(?P<sheet>(?:[^']|'')+)'!\$C\$4:\$C\$503,.*?DATE\((\d+),(\d+),1\).*?DATE\((\d+),(\d+),1\)\)$")


# ---------- nomi ----------

def clean_name(name: str) -> str:
    name = re.sub(r"[\[\]:*?/\\']", " ", name).strip()
    name = re.sub(r"\s+", " ", name)
    return name[:28]


def sheet_name(name: str) -> str:
    return PREFIX + clean_name(name)


def is_trip(ws: Worksheet) -> bool:
    return ws.title.startswith(PREFIX)


def trip_sheets(wb: openpyxl.Workbook) -> list[Worksheet]:
    return [ws for ws in wb.worksheets if is_trip(ws)]


def get(wb: openpyxl.Workbook, name: str) -> Worksheet:
    sh = name if name.startswith(PREFIX) else sheet_name(name)
    if sh not in wb.sheetnames:
        raise KeyError(f"Viaggio '{name}' non trovato")
    return wb[sh]


# ---------- modello ----------

def _copy_cell(src, dst) -> None:
    dst.value = src.value
    if src.has_style:
        dst.font, dst.fill, dst.border = copy(src.font), copy(src.fill), copy(src.border)
        dst.alignment, dst.number_format, dst.protection = copy(src.alignment), src.number_format, copy(src.protection)


def tot_row(ws: Worksheet) -> int:
    """Riga del TOTALE della tabella categorie (12 nel template, più in basso se si sono aggiunte categorie)."""
    for r in range(CAT_FIRST + 1, CAT_FIRST + MAX_CATS + 1):
        if str(ws.cell(r, 7).value or "").strip().upper() == "TOTALE":
            return r
    return TOT_ROW


def _apply_rules(ws: Worksheet) -> None:
    ws.data_validations.dataValidation = []
    dv = DataValidation(type="list", formula1=f"$G${CAT_FIRST}:$G${tot_row(ws) - 1}", allow_blank=True, showErrorMessage=False)
    dv.add(f"D{TX_FIRST}:D{TX_LAST}")
    ws.add_data_validation(dv)


def build_template(wb: openpyxl.Workbook, source: Worksheet) -> Worksheet:
    """Copia il foglio 'viaggio template' dell'utente (anche da un altro file) come foglio nascosto."""
    if TEMPLATE in wb.sheetnames:
        del wb[TEMPLATE]
    ws = wb.create_sheet(TEMPLATE)
    for row in source.iter_rows(min_row=1, max_row=TX_LAST, max_col=10):
        for c in row:
            _copy_cell(c, ws.cell(c.row, c.column))
    for key, dim in source.column_dimensions.items():
        ws.column_dimensions[key].width = dim.width
    for r in (1, 2, 3):
        if source.row_dimensions[r].height:
            ws.row_dimensions[r].height = source.row_dimensions[r].height
    for cf_range, rules in source.conditional_formatting._cf_rules.items():
        for rule in rules:
            ws.conditional_formatting.add(str(cf_range.sqref), rule)
    ws.freeze_panes = "A4"
    # niente riga di esempio, budget vuoti, totale budget sempre presente
    for col in "ABCDE":
        ws[f"{col}{TX_FIRST}"] = None
    for r in range(CAT_FIRST, CAT_LAST + 1):
        ws[f"H{r}"] = None
        ws[f"I{r}"] = f"=SUMIFS($C${TX_FIRST}:$C${TX_LAST},$D${TX_FIRST}:$D${TX_LAST},G{r})"
        ws[f"J{r}"] = f"=H{r}-I{r}"
    ws[f"G{TOT_ROW}"] = "TOTALE"
    ws[f"H{TOT_ROW}"] = f"=SUM(H{CAT_FIRST}:H{CAT_LAST})"
    ws[f"I{TOT_ROW}"] = f"=SUM(I{CAT_FIRST}:I{CAT_LAST})"
    ws[f"J{TOT_ROW}"] = f"=H{TOT_ROW}-I{TOT_ROW}"
    ws[f"H{TOT_ROW}"]._style = copy(ws[f"I{TOT_ROW}"]._style)
    _apply_rules(ws)
    ws.sheet_state = "hidden"
    return ws


# ---------- lettura ----------

def categories(ws: Worksheet) -> list[tuple[str, float]]:
    out = []
    for r in range(CAT_FIRST, tot_row(ws)):
        name = ws.cell(r, 7).value
        if name and str(name).strip():
            b = ws.cell(r, 8).value
            out.append((str(name).strip(), float(b) if isinstance(b, (int, float)) else 0.0))
    return out


def transactions(ws: Worksheet) -> list[dict]:
    out = []
    for r, (d, desc, amt, cat, note) in enumerate(
            ws.iter_rows(min_row=TX_FIRST, max_row=TX_LAST, min_col=1, max_col=5, values_only=True), start=TX_FIRST):
        if desc in (None, "") or not isinstance(amt, (int, float)):
            continue
        day = d.date() if isinstance(d, dt.datetime) else d if isinstance(d, dt.date) else None
        out.append({"row": r, "date": day.isoformat() if day else None, "description": str(desc).strip(),
                    "amount": float(amt), "category": str(cat).strip() if cat else None, "note": note,
                    "trip": ws.title[len(PREFIX):]})
    return out


def summary(ws: Worksheet) -> dict:
    txs = transactions(ws)
    cats = categories(ws)
    known = [c for c, _ in cats]
    spent = {c: 0.0 for c in known}
    other = 0.0
    for t in txs:
        c = X.canonical(t["category"] or "", known)
        if c:
            spent[c] += t["amount"]
        else:
            other += t["amount"]
    rows = [{"category": c, "budget": b, "total": round(spent[c], 2), "left": round(b - spent[c], 2)} for c, b in cats]
    if other:
        # spese con una categoria che non è in tabella (riga calcolata, non esiste nel foglio)
        rows.append({"category": "Senza categoria", "budget": 0.0, "total": round(other, 2), "left": round(-other, 2),
                     "virtual": True})
    dates = sorted(t["date"] for t in txs if t["date"])
    return {"name": ws.title[len(PREFIX):], "sheet": ws.title, "categories": rows,
            "budget": round(sum(b for _, b in cats), 2), "total": round(sum(t["amount"] for t in txs), 2),
            "count": len(txs), "from": dates[0] if dates else None, "to": dates[-1] if dates else None}


def list_trips(wb: openpyxl.Workbook) -> list[dict]:
    trips = [summary(ws) for ws in trip_sheets(wb)]
    return sorted(trips, key=lambda t: t["to"] or "9999", reverse=True)


# ---------- link nei mesi ----------

def _month_bounds(day: dt.date) -> tuple[dt.date, dt.date]:
    start = day.replace(day=1)
    end = (start.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
    return start, end


def link_formula(trip_sheet: str, day: dt.date) -> str:
    start, end = _month_bounds(day)
    q = trip_sheet.replace("'", "''")
    return (f"=SUMIFS('{q}'!$C${TX_FIRST}:$C${TX_LAST},'{q}'!$A${TX_FIRST}:$A${TX_LAST},\">=\"&DATE({start.year},{start.month},1),"
            f"'{q}'!$A${TX_FIRST}:$A${TX_LAST},\"<\"&DATE({end.year},{end.month},1))")


def eval_link(wb: openpyxl.Workbook, formula) -> tuple[str, float] | None:
    """Valore di una riga-link: (nome viaggio, totale nel mese). None se non è una riga-link."""
    if not isinstance(formula, str):
        return None
    m = LINK_RE.match(formula)
    if not m:
        return None
    sheet = m.group("sheet").replace("''", "'")
    if sheet not in wb.sheetnames:
        return sheet[len(PREFIX):], 0.0
    y1, m1, y2, m2 = (int(g) for g in m.groups()[1:])
    start, end = dt.date(y1, m1, 1), dt.date(y2, m2, 1)
    total = sum(t["amount"] for t in transactions(wb[sheet])
                if t["date"] and start <= dt.date.fromisoformat(t["date"]) < end)
    return sheet[len(PREFIX):], round(total, 2)


def _link_rows(ws: Worksheet, trip_sheet: str) -> list[int]:
    q = f"'{trip_sheet.replace(chr(39), chr(39) * 2)}'!"
    return [r for r in range(X.TX_FIRST, X.TX_LAST + 1)
            if isinstance(ws.cell(r, 4).value, str) and ws.cell(r, 4).value.startswith("=SUMIFS(" + q)]


def sync_months(wb: openpyxl.Workbook, trip_ws: Worksheet) -> None:
    """Una riga per ogni mese (modello nuovo) in cui il viaggio ha spese; toglie quelle non più necessarie."""
    months = {dt.date.fromisoformat(t["date"]).replace(day=1) for t in transactions(trip_ws) if t["date"]}
    name = trip_ws.title[len(PREFIX):]
    for ws in X.month_sheets(wb):
        if not X.is_new_layout(ws):
            continue  # i mesi vecchi (Settembre, Ottobre) non si toccano
        rows = _link_rows(ws, trip_ws.title)
        month = next((m for m in months if X.sheet_for(wb, m) is ws), None)
        if month is None:
            for r in sorted(rows, reverse=True):
                X.delete_row(ws, r)
            continue
        if not rows:
            X.ensure_category(wb, ws, LINK_CATEGORY)
            r = X.first_free_row(ws)
            ws.cell(r, 2).value = dt.datetime(month.year, month.month, 1)
            ws.cell(r, 2).number_format = X.DATE_FMT
            rows = [r]
        r = rows[0]
        first = min(dt.date.fromisoformat(t["date"]) for t in transactions(trip_ws)
                    if t["date"] and dt.date.fromisoformat(t["date"]).replace(day=1) == month)
        ws.cell(r, 2).value = dt.datetime(first.year, first.month, first.day)
        ws.cell(r, 3).value = LINK_PREFIX + name
        ws.cell(r, 4).value = link_formula(trip_ws.title, month)
        ws.cell(r, 4).number_format = X.EUR_FMT
        ws.cell(r, 5).value = LINK_CATEGORY
        ws.cell(r, 6).value = "Totale del viaggio nel mese (si aggiorna da solo)"
        for extra in sorted(rows[1:], reverse=True):
            X.delete_row(ws, extra)
    # in ogni mese nuovo che ha spese del viaggio deve esistere il foglio
    for m in months:
        if X.sheet_for(wb, m) is None:
            X.ensure_month(wb, m)
            return sync_months(wb, trip_ws)


# ---------- riepilogo nel foglio 'Viaggi' ----------

def _summary_upsert(wb: openpyxl.Workbook, trip_ws: Worksheet, note: str | None = None) -> None:
    if SUMMARY not in wb.sheetnames:
        return
    s = wb[SUMMARY]
    name = trip_ws.title[len(PREFIX):]
    row = next((r for r in range(SUM_FIRST, SUM_LAST + 1) if s.cell(r, 1).value == name), None)
    if row is None:
        row = next((r for r in range(SUM_FIRST, SUM_LAST + 1) if not s.cell(r, 1).value), None)
    if row is None:
        return
    q = trip_ws.title.replace("'", "''")
    s.cell(row, 1).value = name
    t = tot_row(trip_ws)
    s.cell(row, 2).value = f"='{q}'!H{t}"
    s.cell(row, 3).value = f"='{q}'!I{t}"
    s.cell(row, 4).value = f"=B{row}-C{row}"
    if note is not None:
        s.cell(row, 5).value = note


def _summary_remove(wb: openpyxl.Workbook, name: str) -> None:
    if SUMMARY not in wb.sheetnames:
        return
    s = wb[SUMMARY]
    for r in range(SUM_FIRST, SUM_LAST + 1):
        if s.cell(r, 1).value == name:
            for c in (1, 2, 3, 5):
                s.cell(r, c).value = None
            s.cell(r, 4).value = f"=B{r}-C{r}"


# ---------- scrittura ----------

def create(wb: openpyxl.Workbook, name: str, budgets: dict[str, float] | None = None, note: str | None = None) -> Worksheet:
    if TEMPLATE not in wb.sheetnames:
        raise ValueError("Manca il modello dei viaggi: va prima importato il template")
    title = sheet_name(name)
    if not clean_name(name):
        raise ValueError("Scrivi un nome per il viaggio")
    if title in wb.sheetnames:
        raise ValueError(f"Esiste già un viaggio chiamato '{clean_name(name)}'")
    ws = wb.copy_worksheet(wb[TEMPLATE])
    ws.title = title
    ws.sheet_state = "visible"
    ws.freeze_panes = "A4"
    ws["A1"] = f"VIAGGIO - {clean_name(name)}"
    _apply_rules(ws)
    for cat, value in (budgets or {}).items():
        set_budget(ws, cat, value)
    # i viaggi stanno subito dopo il foglio 'Viaggi'
    anchor = wb.sheetnames.index(SUMMARY) + 1 if SUMMARY in wb.sheetnames else 0
    others = [i for i, n in enumerate(wb.sheetnames) if n.startswith(PREFIX) and n != title]
    target = (max(others) + 1) if others else anchor
    wb.move_sheet(ws, offset=target - wb.sheetnames.index(title))
    _summary_upsert(wb, ws, note)
    return ws


def delete(wb: openpyxl.Workbook, name: str) -> None:
    ws = get(wb, name)
    for month in X.month_sheets(wb):
        if X.is_new_layout(month):
            for r in sorted(_link_rows(month, ws.title), reverse=True):
                X.delete_row(month, r)
    _summary_remove(wb, ws.title[len(PREFIX):])
    del wb[ws.title]


def set_budget(ws: Worksheet, category: str, value: float) -> None:
    for r in range(CAT_FIRST, tot_row(ws)):
        if str(ws.cell(r, 7).value or "").strip().casefold() == category.strip().casefold():
            ws.cell(r, 8).value = float(value)
            return
    raise KeyError(f"Categoria del viaggio '{category}' non trovata")


def copy_budgets(wb: openpyxl.Workbook, ws: Worksheet, source: Worksheet) -> int:
    """Copia categorie e budget di un altro viaggio: aggiorna quelle che ci sono già, aggiunge le mancanti
    (finché c'è posto). Le categorie del viaggio che l'altro non ha restano come sono."""
    have = [c for c, _ in categories(ws)]
    copied = 0
    for cat, budget in categories(source):
        name = X.canonical(cat, have)
        if name:
            set_budget(ws, name, budget)
        else:
            try:
                have.append(add_category(wb, ws, cat, budget))
            except ValueError:  # viaggio pieno
                continue
        copied += 1
    return copied


def add_category(wb: openpyxl.Workbook, ws: Worksheet, name: str, budget: float = 0.0) -> str:
    """Aggiunge una categoria al viaggio: usa una riga vuota della tabella o fa scendere la riga TOTALE."""
    name = re.sub(r"\s+", " ", name).strip()
    if not name:
        raise ValueError("Scrivi un nome per la categoria")
    if name.upper() == "TOTALE":
        raise ValueError("Questo nome non si può usare")
    if X.canonical(name, [c for c, _ in categories(ws)]):
        raise ValueError(f"La categoria '{name}' c'è già in questo viaggio")
    t = tot_row(ws)
    free = next((r for r in range(CAT_FIRST, t) if not str(ws.cell(r, 7).value or "").strip()), None)
    if free is None:
        if t - CAT_FIRST >= MAX_CATS:
            raise ValueError(f"Un viaggio può avere al massimo {MAX_CATS} categorie")
        # la riga TOTALE scende di una; la nuova categoria prende il suo posto con lo stile della riga sopra
        for col in range(7, 11):
            _copy_cell(ws.cell(t, col), ws.cell(t + 1, col))
            ws.cell(t, col).value = None
            ws.cell(t, col)._style = copy(ws.cell(t - 1, col)._style)
        free, t = t, t + 1
        ws.cell(free, 7).value = name  # subito, così tot_row trova il TOTALE nella riga nuova
        ws[f"H{t}"] = f"=SUM(H{CAT_FIRST}:H{t - 1})"
        ws[f"I{t}"] = f"=SUM(I{CAT_FIRST}:I{t - 1})"
        ws[f"J{t}"] = f"=H{t}-I{t}"
        _extend_cf(ws, t)
        _apply_rules(ws)
        _summary_upsert(wb, ws)
    ws.cell(free, 7).value = name
    ws.cell(free, 8).value = float(budget) if budget else None
    ws.cell(free, 9).value = f"=SUMIFS($C${TX_FIRST}:$C${TX_LAST},$D${TX_FIRST}:$D${TX_LAST},G{free})"
    ws.cell(free, 10).value = f"=H{free}-I{free}"
    return name


def _extend_cf(ws: Worksheet, last: int) -> None:
    """La formattazione rosso/verde della colonna J segue la tabella allungata."""
    from openpyxl.formatting.formatting import ConditionalFormattingList
    old = ws.conditional_formatting
    new = ConditionalFormattingList()
    for cf in old:
        ref = str(cf.sqref)
        if ref.startswith(f"J{CAT_FIRST}:J"):
            ref = f"J{CAT_FIRST}:J{last}"
        for rule in cf.rules:
            new.add(ref, rule)
    ws.conditional_formatting = new


def _free_row(ws: Worksheet) -> int:
    for r in range(TX_FIRST, TX_LAST + 1):
        if ws.cell(r, 2).value in (None, "") and ws.cell(r, 3).value in (None, ""):
            return r
    raise ValueError("Foglio del viaggio pieno")


def add_expense(wb, name, day: dt.date, description: str, amount: float, category: str, note: str | None,
                new_category_budget: float | None = None) -> dict:
    ws = get(wb, name)
    known = [c for c, _ in categories(ws)]
    cat = X.canonical(category, known)
    if cat is None and new_category_budget is not None:  # categoria nuova scelta nella schermata +
        cat = add_category(wb, ws, category, new_category_budget)
    if cat is None:
        raise KeyError(f"Categoria del viaggio '{category}' non trovata")
    r = _free_row(ws)
    _write(ws, r, day, description, amount, cat, note)
    sync_months(wb, ws)
    _summary_upsert(wb, ws)
    return {"trip": ws.title[len(PREFIX):], "row": r, "category": cat}


def _write(ws, r, day, description, amount, cat, note):
    ws.cell(r, 1).value = dt.datetime(day.year, day.month, day.day)
    ws.cell(r, 1).number_format = X.DATE_FMT
    ws.cell(r, 2).value = description
    ws.cell(r, 3).value = round(float(amount), 2)
    ws.cell(r, 3).number_format = X.EUR_FMT
    ws.cell(r, 4).value = cat
    ws.cell(r, 5).value = note or None


def _check(ws, row, expect):
    desc, amt = ws.cell(row, 2).value, ws.cell(row, 3).value
    if str(desc or "").strip() != str(expect.get("description", "")).strip() or \
            not isinstance(amt, (int, float)) or abs(float(amt) - float(expect.get("amount", -1))) > 0.005:
        raise X.RowChanged(f"{ws.title}!{row}")


def edit_expense(wb, name, row, expect, day, description, amount, category, note) -> dict:
    ws = get(wb, name)
    _check(ws, row, expect)
    known = [c for c, _ in categories(ws)]
    cat = X.canonical(category, known) or add_category(wb, ws, category)
    old = ws.cell(row, 1).value
    old_day = old.date() if isinstance(old, dt.datetime) else old
    _write(ws, row, day or old_day or dt.date.today(), description, amount, cat, note)
    sync_months(wb, ws)
    return {"trip": ws.title[len(PREFIX):], "row": row, "category": cat}


def delete_expense(wb, name, row, expect) -> None:
    ws = get(wb, name)
    _check(ws, row, expect)
    last = max((t["row"] for t in transactions(ws)), default=row)
    for r in range(row, last):
        for col in range(1, 6):
            ws.cell(r, col).value = ws.cell(r + 1, col).value
    for col in range(1, 6):
        ws.cell(last, col).value = None
    sync_months(wb, ws)


def import_trip(wb: openpyxl.Workbook, source: Worksheet, name: str | None = None) -> Worksheet:
    """Importa un viaggio già compilato (es. dal file Viaggi.xlsx), con le sue categorie e i suoi budget."""
    ws = create(wb, name or source.title)
    for r in range(CAT_FIRST, CAT_LAST + 1):
        cat = source.cell(r, 7).value
        ws.cell(r, 7).value = str(cat).strip() if cat else None
        b = source.cell(r, 8).value
        ws.cell(r, 8).value = b if isinstance(b, (int, float)) else None
    out = TX_FIRST
    for r in range(TX_FIRST, TX_LAST + 1):
        d, desc, amt, cat, note = (source.cell(r, c).value for c in range(1, 6))
        if desc in (None, "") or not isinstance(amt, (int, float)):
            continue
        day = d.date() if isinstance(d, dt.datetime) else d
        _write(ws, out, day, str(desc).strip(), amt, str(cat).strip() if cat else None, note)
        out += 1
    sync_months(wb, ws)
    _summary_upsert(wb, ws)
    return ws
