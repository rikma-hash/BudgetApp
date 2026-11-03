"""Lettura e scrittura del Budget Tracker (xlsx).

Layout di un foglio mensile (modello nuovo, da Novembre 2026 in poi):
  A1        titolo
  A2:E6     borsa di studio / budget personale / aiuto famiglia / budget totale
  A9:F9     intestazioni transazioni, righe 10..509 = Settimana | Data | Descrizione | Importo | Categoria | Note
  H9:P9     tabella budget: Categoria | Budget | Sett 1..5 | Totale | Surplus
  H10:H24   15 slot categoria (quelli vuoti sono liberi per categorie nuove)
  riga 25   TOTALE, riga 26 TOTALE (senza affitto)
  H29..     abbonamenti programmati
"""

from __future__ import annotations

import datetime as dt
import re
import shutil
import zipfile
from copy import copy
from pathlib import Path

import openpyxl
from openpyxl.formatting.rule import CellIsRule
from openpyxl.styles import Font
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.worksheet.worksheet import Worksheet

MONTHS = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio",
          "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"]
TEMPLATE = "_Modello"
SUMMARY = "Riassunto Annuale"

TX_FIRST, TX_LAST = 10, 509
CAT_FIRST, CAT_LAST = 10, 24
TOT_ROW, TOT_NOAFF_ROW = 25, 26
SUB_HEADER, SUB_FIRST, SUB_LAST, SUB_TOT = 29, 30, 34, 35
WEEK_COLS = "JKLMN"  # Sett 1..5

DATE_FMT = "[$-409]dd\\ mmm\\ yyyy"
EUR_FMT = '\\€#,##0.00;[Red]"-€"#,##0.00'


class ExcelLocked(Exception):
    """Il file è aperto in Excel: non scriviamo per non creare conflitti."""


# ---------- file ----------

def lock_file(path: Path) -> Path:
    return path.with_name("~$" + path.name)


def is_locked(path: Path) -> bool:
    return lock_file(path).exists()


def load(path: Path) -> openpyxl.Workbook:
    return openpyxl.load_workbook(path)


def save(wb: openpyxl.Workbook, path: Path, backup_dir: Path, keep: int = 50) -> None:
    if is_locked(path):
        raise ExcelLocked(str(path))
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    shutil.copy2(path, backup_dir / f"{path.stem}-{stamp}{path.suffix}")
    for old in sorted(backup_dir.glob(f"{path.stem}-*{path.suffix}"))[:-keep]:
        old.unlink()
    wb.calculation.fullCalcOnLoad = True
    tmp = path.with_name(path.stem + ".tmp" + path.suffix)
    wb.save(tmp)
    try:
        tmp.replace(path)
    except PermissionError as err:  # Windows: il file è aperto in Excel, che lo tiene bloccato
        tmp.unlink(missing_ok=True)
        raise ExcelLocked(str(path)) from err


def snapshot(path: Path, backup_dir: Path, day: dt.date, keep_days: int = 60) -> list[Path]:
    """Copia del giorno (ultime `keep_days`) e copia del mese (tenute tutte), anche se l'app non scrive.
    Protegge anche dalle modifiche fatte da Excel. Salta i file illeggibili (es. a metà sincronizzazione iCloud)."""
    if not path.exists() or not zipfile.is_zipfile(path):
        return []
    made = []
    for sub, name in (("giornalieri", day.isoformat()), ("mensili", day.strftime("%Y-%m"))):
        target = backup_dir / sub / f"{path.stem}-{name}{path.suffix}"
        if not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)
            made.append(target)
    for old in sorted((backup_dir / "giornalieri").glob(f"{path.stem}-*{path.suffix}"))[:-keep_days]:
        old.unlink()
    return made


# ---------- riconoscimento fogli ----------

def is_new_layout(ws: Worksheet) -> bool:
    return ws["H9"].value == "Categoria" and ws["N9"].value == "Sett 5"


def header_row(ws: Worksheet) -> int | None:
    """Riga delle intestazioni transazioni (4, 8 o 9 a seconda della versione del foglio)."""
    for r in range(3, 11):
        if ws.cell(r, 2).value == "Data" and ws.cell(r, 3).value == "Descrizione":
            return r
    return None


def month_sheets(wb: openpyxl.Workbook) -> list[Worksheet]:
    return [ws for ws in wb.worksheets if ws.title != TEMPLATE and header_row(ws)]


def _sheet_dates(ws: Worksheet) -> list[dt.date]:
    h = header_row(ws)
    out = []
    for (v,) in ws.iter_rows(min_row=h + 1, max_row=TX_LAST, min_col=2, max_col=2, values_only=True):
        if isinstance(v, dt.datetime):
            out.append(v.date())
        elif isinstance(v, dt.date):
            out.append(v)
    return out


def sheet_for(wb: openpyxl.Workbook, day: dt.date) -> Worksheet | None:
    name = MONTHS[day.month - 1]
    with_year = f"{name} {day.year}"
    if with_year in wb.sheetnames:
        return wb[with_year]
    if name in wb.sheetnames:
        ws = wb[name]
        dates = _sheet_dates(ws)
        if not dates or any(d.year == day.year and d.month == day.month for d in dates):
            return ws
    return None


# ---------- categorie ----------

def categories(ws: Worksheet) -> list[tuple[str, float]]:
    out = []
    for r in range(CAT_FIRST, CAT_LAST + 1):
        name = ws.cell(r, 8).value
        if name:
            out.append((str(name).strip(), float(ws.cell(r, 9).value or 0)))
    return out


def canonical(name: str, known: list[str]) -> str | None:
    key = name.strip().casefold()
    for k in known:
        if k.casefold() == key:
            return k
    return None


def add_category(wb: openpyxl.Workbook, name: str, budget: float, from_sheet: Worksheet) -> None:
    """Aggiunge la categoria al modello e a from_sheet + ai fogli dei mesi successivi."""
    targets = [wb[TEMPLATE]]
    sheets = [ws for ws in month_sheets(wb) if is_new_layout(ws)]
    if from_sheet in sheets:
        targets += sheets[sheets.index(from_sheet):]
    for ws in targets:
        if canonical(name, [c for c, _ in categories(ws)]):
            continue
        for r in range(CAT_FIRST, CAT_LAST + 1):
            if not ws.cell(r, 8).value:
                ws.cell(r, 8).value = name
                ws.cell(r, 9).value = budget if ws.title != TEMPLATE else None
                break
        else:
            raise ValueError(f"Nessuno slot libero per nuove categorie in '{ws.title}'")


def set_budget(ws: Worksheet, name: str, budget: float) -> None:
    for r in range(CAT_FIRST, CAT_LAST + 1):
        if str(ws.cell(r, 8).value or "").casefold() == name.casefold():
            ws.cell(r, 9).value = budget
            return
    raise KeyError(name)


# ---------- layout del modello ----------

def _week_formula(r: int) -> str:
    return f'=IF(B{r}="","","Sett "&MIN(5,INT((DAY(B{r})-1)/7)+1))'


def _cat_row(ws: Worksheet, r: int) -> None:
    for i, col in enumerate(WEEK_COLS):
        ws[f"{col}{r}"] = (f'=IF($H{r}="","",SUMIFS($D${TX_FIRST}:$D${TX_LAST},$E${TX_FIRST}:$E${TX_LAST},'
                           f'$H{r},$A${TX_FIRST}:$A${TX_LAST},{col}$9))')
    ws[f"O{r}"] = f'=IF($H{r}="","",SUM(J{r}:N{r}))'
    ws[f"P{r}"] = f'=IF($H{r}="","",I{r}-O{r})'


def apply_rules(ws: Worksheet) -> None:
    ws.data_validations.dataValidation = []
    dv = DataValidation(type="list", formula1=f"$H${CAT_FIRST}:$H${CAT_LAST}", allow_blank=True,
                        showErrorMessage=False)
    dv.add(f"E{TX_FIRST}:E{TX_LAST}")
    ws.add_data_validation(dv)
    ws.conditional_formatting = type(ws.conditional_formatting)()
    ws.conditional_formatting.add(f"P{CAT_FIRST}:P{TOT_NOAFF_ROW}",
                                  CellIsRule(operator="lessThan", formula=["0"], font=Font(color="FFC00000")))


def build_template(wb: openpyxl.Workbook, source: Worksheet) -> Worksheet:
    """Crea il foglio nascosto _Modello partendo dal layout di `source` (Novembre, modello vecchio a 4 settimane)."""
    st = {c.coordinate: copy(c._style) for row in source["H8:O30"] for c in row}
    ws = wb.copy_worksheet(source)
    ws.title = TEMPLATE

    # transazioni vuote, formula settimana a 5
    for r in range(TX_FIRST, TX_LAST + 1):
        ws[f"A{r}"] = _week_formula(r)
        for col in "BCDEF":
            ws[f"{col}{r}"] = None

    # svuota tutta l'area budget/abbonamenti
    for rng in list(ws.merged_cells.ranges):
        if rng.min_col >= 8:
            ws.unmerge_cells(str(rng))
    for row in ws["H8:P40"]:
        for c in row:
            c.value = None
            c._style = copy(ws["G40"]._style)

    def put(coord, value, style_from):
        ws[coord] = value
        ws[coord]._style = copy(st[style_from])

    # intestazione
    for col in "HIJKLMNOP":
        ws[f"{col}8"]._style = copy(st["H8"])
    ws["H8"] = "BUDGET PER CATEGORIA"
    ws.merge_cells("H8:P8")
    heads = ["Categoria", "Budget Mensile", "Sett 1", "Sett 2", "Sett 3", "Sett 4", "Sett 5",
             "Totale Mese", "Surplus/(Deficit)"]
    for col, text in zip("HIJKLMNOP", heads):
        put(f"{col}9", text, "H9")

    # 15 slot categoria
    old_cats = [source.cell(r, 8).value for r in range(10, 19)]
    for i, r in enumerate(range(CAT_FIRST, CAT_LAST + 1)):
        put(f"H{r}", old_cats[i] if i < len(old_cats) else None, "H10")
        put(f"I{r}", None, "I10")
        _cat_row(ws, r)
        for col in WEEK_COLS + "O":
            ws[f"{col}{r}"]._style = copy(st["J10"])
        ws[f"P{r}"]._style = copy(st["O10"])

    # totali
    style_map = {"H": "H19", "I": "I19", "J": "J19", "K": "J19", "L": "J19", "M": "J19", "N": "J19",
                 "O": "N19", "P": "O19"}
    put(f"H{TOT_ROW}", "TOTALE", "H19")
    put(f"H{TOT_NOAFF_ROW}", "TOTALE (senza affitto)", "H20")
    for col in "IJKLMNO":
        put(f"{col}{TOT_ROW}", f"=SUM({col}{CAT_FIRST}:{col}{CAT_LAST})", style_map[col])
        put(f"{col}{TOT_NOAFF_ROW}",
            f'={col}{TOT_ROW}-SUMIF($H${CAT_FIRST}:$H${CAT_LAST},"Affitto",{col}${CAT_FIRST}:{col}${CAT_LAST})',
            style_map[col].replace("19", "20"))
    put(f"P{TOT_ROW}", f"=I{TOT_ROW}-O{TOT_ROW}", "O19")
    put(f"P{TOT_NOAFF_ROW}", f"=I{TOT_NOAFF_ROW}-O{TOT_NOAFF_ROW}", "O20")

    # abbonamenti programmati
    for col in "HIJ":
        ws[f"{col}{SUB_HEADER}"]._style = copy(st["H24"])
    ws[f"H{SUB_HEADER}"] = "💳 ABBONAMENTI PROGRAMMATI"
    ws.merge_cells(f"H{SUB_HEADER}:J{SUB_HEADER}")
    old_subs = [(source.cell(r, 8).value, source.cell(r, 9).value) for r in range(25, 30)]
    for i, r in enumerate(range(SUB_FIRST, SUB_LAST + 1)):
        name, amount = old_subs[i] if i < len(old_subs) else (None, None)
        put(f"H{r}", name, "H25")
        put(f"I{r}", amount, "I25")
        put(f"J{r}", False if name else None, "J25")
    put(f"H{SUB_TOT}", "TOTALE ABBONAMENTI:", "H30")
    put(f"I{SUB_TOT}", f"=SUM(I{SUB_FIRST}:I{SUB_LAST})", "I30")

    # larghezze colonne: N (Sett 5) come M, O/P come vecchie N/O
    ws.column_dimensions["N"].width = 12
    ws.column_dimensions["O"].width = 14
    ws.column_dimensions["P"].width = 18
    ws.column_dimensions["M"].width = 12

    ws["A1"] = "📊 TRACKER SPESE - MODELLO"
    ws["B6"] = "=B2+B3+B4"
    for coord in ("B3", "B4", "B5", "C2"):
        ws[coord] = None
    apply_rules(ws)
    ws.sheet_state = "hidden"
    return ws


# ---------- creazione mese ----------

def _summary_add(wb: openpyxl.Workbook, label: str, sheet_name: str) -> None:
    ws = wb[SUMMARY]
    tot = next(r for r in range(4, 200) if ws.cell(r, 1).value == "TOTALE")
    # sposta la riga TOTALE (solo colonne A-D) una riga sotto
    for col in range(1, 5):
        src, dst = ws.cell(tot, col), ws.cell(tot + 1, col)
        dst._style = copy(src._style)
        if tot > 4:
            src._style = copy(ws.cell(tot - 1, col)._style)
        else:  # primo mese (file nuovo): sopra c'è l'intestazione, uso lo stile del TOTALE senza grassetto
            font = copy(src.font)
            font.bold = False
            src.font = font
    ref = f"'{sheet_name}'"
    ws.cell(tot, 1).value = label
    ws.cell(tot, 2).value = f"={ref}!I{TOT_ROW}"
    ws.cell(tot, 3).value = f"={ref}!O{TOT_ROW}"
    ws.cell(tot, 4).value = f"=B{tot}-C{tot}"
    t = tot + 1
    ws.cell(t, 1).value = "TOTALE"
    ws.cell(t, 2).value = f"=SUM(B4:B{tot})"
    ws.cell(t, 3).value = f"=SUM(C4:C{tot})"
    ws.cell(t, 4).value = f"=B{t}-C{t}"


def _previous_new_sheet(wb: openpyxl.Workbook) -> Worksheet | None:
    sheets = [ws for ws in month_sheets(wb) if is_new_layout(ws)]
    return sheets[-1] if sheets else None


def ensure_month(wb: openpyxl.Workbook, day: dt.date) -> tuple[Worksheet, bool]:
    """Ritorna il foglio del mese di `day`, creandolo dal modello se manca."""
    ws = sheet_for(wb, day)
    if ws is not None:
        return ws, False
    name = MONTHS[day.month - 1]
    title = name if name not in wb.sheetnames else f"{name} {day.year}"
    prev = _previous_new_sheet(wb)

    ws = wb.copy_worksheet(wb[TEMPLATE])
    ws.title = title
    ws.sheet_state = "visible"
    for rng in ("A1:E1", "H8:P8", f"H{SUB_HEADER}:J{SUB_HEADER}") + ((f"H{INC_HEADER}:J{INC_HEADER}",) if income_list_mode(ws) else ()):
        if rng not in {str(m) for m in ws.merged_cells.ranges}:
            ws.merge_cells(rng)
    ws.freeze_panes = "A10"
    ws["A1"] = f"📊 TRACKER SPESE - {title.upper()}"

    if prev is not None and income_list_mode(ws):
        for r in range(INC_FIRST, INC_LAST + 1):
            for col in (8, 9):
                ws.cell(r, col).value = prev.cell(r, col).value if income_list_mode(prev) else None
    elif prev is not None:
        for coord in ("B2", "D2", "B3", "B4", OTHER_LABEL, OTHER_CELL):
            ws[coord] = prev[coord].value
        if other_income(ws):
            ws["B6"] = "=B2+B3+B4+B7"
    if prev is not None:
        for r in range(CAT_FIRST, CAT_LAST + 1):
            ws.cell(r, 8).value = prev.cell(r, 8).value
            ws.cell(r, 9).value = prev.cell(r, 9).value
        for r in range(SUB_FIRST, SUB_LAST + 1):
            for col in (8, 9):
                ws.cell(r, col).value = prev.cell(r, col).value
            ws.cell(r, 10).value = False if prev.cell(r, 8).value else None
    apply_rules(ws)

    # ordine: subito dopo l'ultimo foglio mese
    others = [s for s in month_sheets(wb) if s is not ws]
    if others:
        target = wb.sheetnames.index(others[-1].title) + 1
        wb.move_sheet(ws, offset=target - wb.sheetnames.index(ws.title))
    _summary_add(wb, title, title)
    return ws, True


# ---------- transazioni ----------

def append_expense(wb: openpyxl.Workbook, day: dt.date, description: str, amount: float,
                   category: str, note: str | None = None) -> dict:
    ws, created = ensure_month(wb, day)
    if not is_new_layout(ws):
        raise ValueError(f"Il foglio '{ws.title}' usa il modello vecchio: non ci scrivo")
    known = [c for c, _ in categories(ws)]
    cat = canonical(category, known)
    if cat is None:
        raise KeyError(category)
    r = first_free_row(ws)
    ws.cell(r, 2).value = dt.datetime(day.year, day.month, day.day)
    ws.cell(r, 2).number_format = DATE_FMT
    ws.cell(r, 3).value = description
    ws.cell(r, 4).value = round(float(amount), 2)
    ws.cell(r, 4).number_format = EUR_FMT
    ws.cell(r, 5).value = cat
    ws.cell(r, 6).value = note or None
    return {"sheet": ws.title, "row": r, "week": week_of(day), "category": cat, "created_sheet": created}


def week_of(day: dt.date) -> int:
    return min(5, (day.day - 1) // 7 + 1)


def _week_value(ws: Worksheet, a_value, day: dt.date | None) -> int | None:
    """Settimana di una riga: calcolata dalla data nei fogli nuovi, letta dalla colonna A in quelli vecchi."""
    if is_new_layout(ws):
        return week_of(day) if day else None
    if isinstance(a_value, (int, float)):
        return int(a_value)
    m = re.search(r"\d", str(a_value or ""))
    return int(m.group(0)) if m else (week_of(day) if day else None)


def tx_last_row(ws: Worksheet) -> int:
    """Ultima riga utilizzabile per le transazioni (prima di 'TOTALE SPESO' nei fogli vecchi)."""
    h = header_row(ws)
    for r in range(h + 1, TX_LAST + 1):
        if str(ws.cell(r, 3).value or "").startswith("TOTALE"):
            return r - 1
    return TX_LAST


def transactions(ws: Worksheet) -> list[dict]:
    h = header_row(ws)
    if h is None:
        return []
    out = []
    for r, (wk, d, desc, amt, cat, *rest) in enumerate(
            ws.iter_rows(min_row=h + 1, max_row=tx_last_row(ws), min_col=1, max_col=6, values_only=True),
            start=h + 1):
        trip = None
        if isinstance(amt, str) and amt.startswith("=SUMIFS("):
            from . import trips  # import qui: trips usa questo modulo
            link = trips.eval_link(ws.parent, amt)
            if link:
                trip, amt = link
        if desc in (None, "") or not isinstance(amt, (int, float)):
            continue
        if isinstance(d, dt.datetime):
            d = d.date()
        day = d if isinstance(d, dt.date) else None
        out.append({"row": r, "date": day.isoformat() if day else None,
                    "description": str(desc).strip(), "amount": float(amt),
                    "category": str(cat).strip() if cat else None, "note": rest[0] if rest else None,
                    "week": _week_value(ws, wk, day), "sheet": ws.title, "trip": trip})
    return out


def history(wb: openpyxl.Workbook) -> list[dict]:
    return [t for ws in month_sheets(wb) for t in transactions(ws)]


def budget_table(ws: Worksheet) -> list[tuple[str, float]]:
    """Categorie e budget di un foglio mese, qualunque versione del modello."""
    if is_new_layout(ws):
        return categories(ws)
    h = header_row(ws)
    cat_col = next((c for c in range(7, 12) if ws.cell(h, c).value == "Categoria"), None)
    if cat_col is None:
        return []
    out = []
    for r in range(h + 1, h + 30):
        name = ws.cell(r, cat_col).value
        if name is None:
            continue
        if str(name).strip().upper().startswith("TOTALE"):
            break
        b = ws.cell(r, cat_col + 1).value
        out.append((str(name).strip(), float(b) if isinstance(b, (int, float)) else 0.0))
    return out


def summary(ws: Worksheet) -> dict:
    """Totali calcolati in Python (openpyxl non ha i valori delle formule)."""
    cats = budget_table(ws)
    known = [c for c, _ in cats]
    spent = {c: [0.0] * 5 for c in known}
    extra: dict[str, list[float]] = {}
    for t in transactions(ws):
        c = canonical(t["category"] or "", known)
        bucket = spent[c] if c else extra.setdefault(t["category"] or "Senza categoria", [0.0] * 5)
        wk = min(5, max(1, t["week"] or 1))
        bucket[wk - 1] += t["amount"]
    rows = [{"category": c, "budget": b, "weeks": [round(x, 2) for x in spent[c]],
             "total": round(sum(spent[c]), 2), "left": round(b - sum(spent[c]), 2)} for c, b in cats]
    rows += [{"category": c, "budget": 0.0, "weeks": [round(x, 2) for x in w], "total": round(sum(w), 2),
              "left": round(-sum(w), 2)} for c, w in extra.items()]
    return {"sheet": ws.title, "categories": rows, "editable": is_new_layout(ws),
            "budget": round(sum(b for _, b in cats), 2),
            "total": round(sum(r["total"] for r in rows), 2),
            "income": income(ws)}


# ---------- entrate ----------

INCOME_CELLS = {"borsa": "B2", "personale": "B3", "famiglia": "B4"}


def _eval_sum(ws: Worksheet, value) -> float:
    """Valuta un numero o una formula semplice tipo =B3+B4+B2."""
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str) and value.startswith("="):
        total = 0.0
        for sign, ref in re.findall(r"([+-]?)\s*\$?([A-Z]+\$?\d+)", value[1:]):
            v = ws[ref.replace("$", "")].value
            v = float(v) if isinstance(v, (int, float)) else 0.0
            total += -v if sign == "-" else v
        return total
    return 0.0


CARRY_CELL = "B5"          # surplus/deficit dei mesi scorsi riportato nel budget del mese
TOTAL_WITH_CARRY = "=B2+B3+B4+B5"
OTHER_LABEL, OTHER_CELL = "A7", "B7"   # "Altre entrate:" (scritta solo nei mesi in cui si usa)


def other_income(ws: Worksheet) -> float:
    if not is_new_layout(ws) or not str(ws[OTHER_LABEL].value or "").lower().startswith("altre entrate"):
        return 0.0
    v = ws[OTHER_CELL].value
    return float(v) if isinstance(v, (int, float)) else 0.0


def carry_included(ws: Worksheet) -> bool:
    """Il riporto conta nelle entrate solo se la formula del BUDGET TOTALE (B6) include B5."""
    f = str(ws["B6"].value or "")
    return is_new_layout(ws) and f.startswith("=") and "B5" in f.replace("$", "")


# Entrate "a lista" (modello vuoto per gli amici): voci libere nome/importo sotto gli abbonamenti.
# B2 = totale della lista, B6 = B2 (+B5 se il riporto è incluso). Il file dell'utente resta con le celle fisse.
INC_HEADER, INC_FIRST, INC_LAST, INC_TOT = 37, 38, 47, 48
INC_TITLE = "💶 ENTRATE DEL MESE"


def income_list_mode(ws: Worksheet) -> bool:
    return is_new_layout(ws) and str(ws[f"H{INC_HEADER}"].value or "").startswith(INC_TITLE)


def income_items(ws: Worksheet) -> list[dict]:
    out = []
    for r in range(INC_FIRST, INC_LAST + 1):
        name, amount = ws.cell(r, 8).value, ws.cell(r, 9).value
        if name or isinstance(amount, (int, float)):
            out.append({"name": str(name or "Entrata"), "amount": round(float(amount) if isinstance(amount, (int, float)) else 0.0, 2)})
    return out


def make_income_list(ws: Worksheet) -> None:
    """Trasforma le entrate fisse del foglio in una lista libera (usato per il modello vuoto)."""
    st = {k: copy(ws[k]._style) for k in (f"H{SUB_HEADER}", f"H{SUB_FIRST}", f"I{SUB_FIRST}", f"H{SUB_TOT}", f"I{SUB_TOT}")}
    for col in "HIJ":
        ws[f"{col}{INC_HEADER}"]._style = copy(st[f"H{SUB_HEADER}"])
    ws[f"H{INC_HEADER}"] = INC_TITLE
    if f"H{INC_HEADER}:J{INC_HEADER}" not in {str(m) for m in ws.merged_cells.ranges}:
        ws.merge_cells(f"H{INC_HEADER}:J{INC_HEADER}")
    for r in range(INC_FIRST, INC_LAST + 1):
        ws[f"H{r}"]._style, ws[f"I{r}"]._style = copy(st[f"H{SUB_FIRST}"]), copy(st[f"I{SUB_FIRST}"])
        ws[f"H{r}"], ws[f"I{r}"] = None, None
    ws[f"H{INC_TOT}"]._style, ws[f"I{INC_TOT}"]._style = copy(st[f"H{SUB_TOT}"]), copy(st[f"I{SUB_TOT}"])
    ws[f"H{INC_TOT}"], ws[f"I{INC_TOT}"] = "TOTALE ENTRATE:", f"=SUM(I{INC_FIRST}:I{INC_LAST})"
    for coord in ("B2", "B3", "B4", "A3", "A4", "D2", "E2", OTHER_LABEL, OTHER_CELL):
        ws[coord] = None
    ws["A2"], ws["B2"] = "Entrate del mese (tabella in H37):", f"=I{INC_TOT}"
    ws["B6"] = "=B2"


def income(ws: Worksheet) -> dict:
    """Entrate del mese: borsa + budget personale + aiuto famiglia, oppure la lista libera (+ riporto, se scelto)."""
    if income_list_mode(ws):
        items = income_items(ws)
        parts = {"items": items}
        base = sum(i["amount"] for i in items)
    else:
        parts = {k: _eval_sum(ws, ws[c].value) for k, c in INCOME_CELLS.items()}
        parts["altro"] = other_income(ws)
        base = sum(parts.values())
    carry = _eval_sum(ws, ws[CARRY_CELL].value) if carry_included(ws) else 0.0
    total = base + carry if income_list_mode(ws) else None
    for r in range(2, 8) if total is None else ():
        label = str(ws.cell(r, 1).value or "").upper()
        if "BUDGET TOTALE" in label or "TOTALE DISPONIBILE" in label:
            total = _eval_sum(ws, ws.cell(r, 2).value)
            break
    if total is None:
        total = base + carry
    if not is_new_layout(ws):
        base = total  # nei mesi vecchi il totale scritto è la base
    return {**{k: (round(v, 2) if isinstance(v, float) else v) for k, v in parts.items()}, "riporto": round(carry, 2),
            "base": round(base, 2), "total": round(total, 2)}


def set_income(ws: Worksheet, values: dict) -> None:
    if not is_new_layout(ws):
        raise ValueError("Le entrate si modificano solo nei mesi con il modello nuovo")
    for k, v in values.items():
        if k in INCOME_CELLS and v is not None:
            ws[INCOME_CELLS[k]] = float(v)
    carry_on = carry_included(ws)
    if "riporto" in values:
        v = values["riporto"]
        carry_on = bool(v)
        if v:  # riporto scelto: B5 entra nel BUDGET TOTALE
            ws[CARRY_CELL] = round(float(v), 2)
            ws["A5"] = "Surplus/deficit riportato:"
        # ignorato: B5 resta com'è (solo informativo) e non conta
    if income_list_mode(ws):
        if values.get("items") is not None:
            items = [i for i in values["items"] if str(i.get("name") or "").strip()][:INC_LAST - INC_FIRST + 1]
            for n, r in enumerate(range(INC_FIRST, INC_LAST + 1)):
                it = items[n] if n < len(items) else None
                ws.cell(r, 8).value = str(it["name"]).strip()[:40] if it else None
                ws.cell(r, 9).value = round(float(it.get("amount") or 0), 2) if it else None
        ws["B2"] = f"=I{INC_TOT}"
        ws["B6"] = "=B2" + ("+B5" if carry_on else "")
        return
    if "altro" in values:
        v = values["altro"]
        ws[OTHER_LABEL], ws[OTHER_CELL] = ("Altre entrate:", round(float(v), 2)) if v else (None, None)
    ws["B6"] = "=B2+B3+B4" + ("+B7" if other_income(ws) else "") + ("+B5" if carry_on else "")


# ---------- riassunto annuale ----------

def year(wb: openpyxl.Workbook, today: dt.date | None = None) -> dict:
    """Riassunto per mese. I mesi dopo quello in corso sono 'futuri' e non entrano nei totali."""
    s = wb[SUMMARY]
    today = today or dt.date.today()
    cur = sheet_for(wb, today)
    rows, seen_current = [], False
    for r in range(4, 200):
        label = s.cell(r, 1).value
        if label is None:
            continue
        if str(label).strip().upper() == "TOTALE":
            break
        sheet = wb[label] if label in wb.sheetnames else None
        summ = summary(sheet) if sheet is not None and header_row(sheet) else None
        b, c = s.cell(r, 2).value, s.cell(r, 3).value
        budget = float(b) if isinstance(b, (int, float)) else (summ["budget"] if summ else 0.0)
        spent = float(c) if isinstance(c, (int, float)) else (summ["total"] if summ else 0.0)
        inc = summ["income"]["base"] if summ else budget
        is_current = cur is not None and sheet is cur
        rows.append({"month": str(label), "sheet": sheet.title if sheet is not None else None,
                     "income": round(inc, 2), "budget": round(budget, 2), "spent": round(spent, 2),
                     "surplus": round(budget - spent, 2), "saved": round(inc - spent, 2),
                     "current": is_current, "future": seen_current and not is_current})
        seen_current = seen_current or is_current
    counted = [r for r in rows if not r["future"]]
    tot = {k: round(sum(r[k] for r in counted), 2) for k in ("income", "budget", "spent", "surplus", "saved")}
    return {"months": rows, "total": tot}


def carry_before(wb: openpyxl.Workbook, sheet: str) -> float:
    """Surplus/deficit accumulato nei mesi prima di `sheet` (solo mesi già iniziati)."""
    total = 0.0
    for m in year(wb)["months"]:
        if m["sheet"] == sheet:
            break
        if not m["future"] and not m["current"]:  # solo mesi conclusi
            total += m["surplus"]
    return round(total, 2)


# ---------- modifica / eliminazione ----------

class RowChanged(Exception):
    """La riga non contiene più la spesa attesa (il file è stato modificato nel frattempo)."""


def _check_row(ws: Worksheet, row: int, expect: dict) -> None:
    desc, amt = ws.cell(row, 3).value, ws.cell(row, 4).value
    if isinstance(amt, str) and amt.startswith("=SUMIFS("):
        raise ValueError("Questa riga è il totale di un viaggio: modifica le spese dalla sezione Viaggi")
    if str(desc or "").strip() != str(expect.get("description", "")).strip() or \
            not isinstance(amt, (int, float)) or abs(float(amt) - float(expect.get("amount", -1))) > 0.005:
        raise RowChanged(f"{ws.title}!{row}")


def first_free_row(ws: Worksheet) -> int:
    for r in range(TX_FIRST, TX_LAST + 1):
        if ws.cell(r, 2).value is None and ws.cell(r, 3).value is None:
            return r
    raise ValueError(f"Foglio '{ws.title}' pieno")


def ensure_category(wb: openpyxl.Workbook, ws: Worksheet, name: str) -> str:
    known = [c for c, _ in categories(ws)]
    found = canonical(name, known)
    if found:
        return found
    add_category(wb, name, 0.0, ws)
    return name


def delete_row(ws: Worksheet, row: int) -> None:
    """Elimina una riga di spesa spostando in su quelle sotto (nessun buco)."""
    last = tx_last_row(ws)
    first_col = 2 if is_new_layout(ws) else 1  # nei fogli nuovi la colonna A è una formula
    end = max([r for r in range(row, last + 1) if ws.cell(r, 3).value not in (None, "")], default=row)
    for r in range(row, min(end, last)):
        for col in range(first_col, 7):
            ws.cell(r, col).value = ws.cell(r + 1, col).value
            if col in (2, 4):
                ws.cell(r, col).number_format = ws.cell(r + 1, col).number_format
    for col in range(2, 7):
        ws.cell(min(end, last), col).value = None


def delete_expense(wb: openpyxl.Workbook, sheet: str, row: int, expect: dict) -> None:
    ws = wb[sheet]
    _check_row(ws, row, expect)
    delete_row(ws, row)


def update_expense(wb: openpyxl.Workbook, sheet: str, row: int, expect: dict, day: dt.date | None,
                   description: str, amount: float, category: str, note: str | None) -> dict:
    ws = wb[sheet]
    _check_row(ws, row, expect)
    known = [c for c, _ in budget_table(ws)]
    cat = canonical(category, known) or category.strip()
    old = ws.cell(row, 2).value
    old_day = old.date() if isinstance(old, dt.datetime) else old if isinstance(old, dt.date) else None
    if day and old_day and (day.year, day.month) != (old_day.year, old_day.month):
        # cambio di mese: la spesa si sposta nel foglio giusto
        info = append_expense(wb, day, description, amount, category, note)
        delete_expense(wb, sheet, row, expect)
        return {**info, "moved": True}
    if day and day != old_day:
        if not is_new_layout(ws):
            raise ValueError("Nei mesi vecchi (Settembre, Ottobre) la data non si modifica dall'app")
        ws.cell(row, 2).value = dt.datetime(day.year, day.month, day.day)
        ws.cell(row, 2).number_format = DATE_FMT
    ws.cell(row, 3).value = description
    ws.cell(row, 4).value = round(float(amount), 2)
    ws.cell(row, 5).value = cat
    ws.cell(row, 6).value = note or None
    return {"sheet": sheet, "row": row, "category": cat, "moved": False}


# ---------- gestione categorie ----------

def _category_sheets(wb: openpyxl.Workbook) -> list[Worksheet]:
    """Il modello e tutti i mesi con il modello nuovo (i mesi vecchi restano com'erano)."""
    return [wb[TEMPLATE]] + [ws for ws in month_sheets(wb) if is_new_layout(ws)]


def rename_category(wb: openpyxl.Workbook, old: str, new: str) -> int:
    new = new.strip()
    if not new:
        raise ValueError("Scrivi il nuovo nome")
    changed = 0
    for ws in _category_sheets(wb):
        known = [c for c, _ in categories(ws)]
        src = canonical(old, known)
        if src is None:
            continue
        clash = canonical(new, known)
        if clash and clash.casefold() != src.casefold():
            raise ValueError(f"Esiste già una categoria '{clash}'")
        for r in range(CAT_FIRST, CAT_LAST + 1):
            if str(ws.cell(r, 8).value or "").strip().casefold() == src.casefold():
                ws.cell(r, 8).value = new
        for r in range(TX_FIRST, TX_LAST + 1):
            if str(ws.cell(r, 5).value or "").strip().casefold() == src.casefold():
                ws.cell(r, 5).value = new
                changed += 1
    return changed


def delete_category(wb: openpyxl.Workbook, name: str, move_to: str | None) -> int:
    if name.strip().casefold() == "viaggi":
        raise ValueError("La categoria Viaggi serve per i totali dei viaggi: non si può eliminare")
    moved = 0
    for ws in _category_sheets(wb):
        known = [c for c, _ in categories(ws)]
        src = canonical(name, known)
        if src is None:
            continue
        dest = canonical(move_to, known) if move_to else None
        has_rows = any(str(ws.cell(r, 5).value or "").strip().casefold() == src.casefold()
                       for r in range(TX_FIRST, TX_LAST + 1))
        if has_rows and not dest:
            raise ValueError(f"'{src}' ha delle spese in {ws.title}: scegli in quale categoria spostarle")
        for r in range(TX_FIRST, TX_LAST + 1):
            if str(ws.cell(r, 5).value or "").strip().casefold() == src.casefold():
                ws.cell(r, 5).value = dest
                moved += 1
        for r in range(CAT_FIRST, CAT_LAST + 1):
            if str(ws.cell(r, 8).value or "").strip().casefold() == src.casefold():
                ws.cell(r, 8).value = None
                ws.cell(r, 9).value = None
    return moved


# ---------- abbonamenti programmati (H30:J34: nome, importo, casella "inserito") ----------

_SUB_DAY = re.compile(r"\((\d{1,2})\b[^)]*\)")


def _sub_name(raw: str) -> str:
    """'Streaming (24 ott)' → 'Streaming' (il giorno tra parentesi non va nella descrizione della spesa)."""
    return _SUB_DAY.sub("", raw).strip() or raw.strip()


def subscriptions(ws: Worksheet) -> list[dict]:
    out = []
    for r in range(SUB_FIRST, SUB_LAST + 1):
        name, amount, done = ws.cell(r, 8).value, ws.cell(r, 9).value, ws.cell(r, 10).value
        if not name or not isinstance(amount, (int, float)):
            continue
        m = _SUB_DAY.search(str(name))
        day = int(m.group(1)) if m and 1 <= int(m.group(1)) <= 31 else 1
        out.append({"row": r, "label": str(name).strip(), "name": _sub_name(str(name)), "amount": float(amount),
                    "day": day, "done": done is True})
    return out


def set_subscriptions(wb: openpyxl.Workbook, from_ws: Worksheet, items: list[dict]) -> None:
    """Scrive la lista (max 5) nel mese scelto, nei mesi dopo e nel modello. La casella 'inserito' resta a chi
    ce l'aveva già (stesso nome), così modificare la lista non fa reinserire un abbonamento."""
    if len(items) > SUB_LAST - SUB_FIRST + 1:
        raise ValueError(f"Al massimo {SUB_LAST - SUB_FIRST + 1} abbonamenti")
    sheets = [ws for ws in month_sheets(wb) if is_new_layout(ws)]
    targets = [wb[TEMPLATE]] + (sheets[sheets.index(from_ws):] if from_ws in sheets else [])
    for ws in targets:
        done = {s["name"].casefold(): s["done"] for s in subscriptions(ws)}
        for i, r in enumerate(range(SUB_FIRST, SUB_LAST + 1)):
            it = items[i] if i < len(items) else None
            if it is None:
                for col in (8, 9, 10):
                    ws.cell(r, col).value = None
                continue
            day = int(it.get("day") or 1)
            name = str(it["name"]).strip()
            ws.cell(r, 8).value = f"{name} ({day})" if day > 1 else name
            ws.cell(r, 9).value = round(float(it["amount"]), 2)
            ws.cell(r, 10).value = done.get(name.casefold(), False) if ws.title != TEMPLATE else False


def apply_subscriptions(wb: openpyxl.Workbook, today: dt.date, only: set[str] | None = None) -> list[dict]:
    """Inserisce nel mese di oggi gli abbonamenti arrivati al loro giorno e non ancora inseriti
    (solo quelli in `only`, nomi in minuscolo, se indicato).
    Se nel mese c'è già una spesa con lo stesso nome e importo (scritta a mano), segna solo la casella."""
    ws = sheet_for(wb, today)
    if ws is None or not is_new_layout(ws):
        return []
    last = (today.replace(day=28) + dt.timedelta(days=4)).replace(day=1) - dt.timedelta(days=1)
    txs = transactions(ws)
    added = []
    for s in subscriptions(ws):
        if s["done"] or min(s["day"], last.day) > today.day or (only is not None and s["name"].casefold() not in only):
            continue
        key = s["name"].casefold()
        if not any(key in (t["description"] or "").casefold() and abs(t["amount"] - s["amount"]) < 0.01 for t in txs):
            cat = ensure_category(wb, ws, "Abbonamenti")
            day = today.replace(day=min(s["day"], last.day))
            append_expense(wb, day, s["name"], s["amount"], cat, "Abbonamento inserito in automatico")
            added.append({"name": s["name"], "amount": s["amount"], "date": day.isoformat(), "sheet": ws.title})
        ws.cell(s["row"], 10).value = True
    return added
