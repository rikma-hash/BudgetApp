"""Lettura di estratti conto / movimenti carta (CSV o PDF scaricati dall'app della banca).

Restituisce le uscite come righe {date, description, original, amount}; le entrate vengono contate a parte.
Le colonne dei CSV si riconoscono dal nome (italiano, tedesco, inglese); per i PDF si leggono le righe
che iniziano con una data e finiscono con un importo.
"""

from __future__ import annotations

import csv
import datetime as dt
import io
import re

# nomi di colonna conosciuti (minuscolo, senza accenti strani)
DATE_COLS = ["data operazione", "data contabile", "data", "buchungstag", "buchungsdatum", "datum", "started date",
             "completed date", "date", "transaction date", "booking date", "data valuta", "valuta", "valutadatum"]
DESC_COLS = ["descrizione operazione", "descrizione", "causale", "dettagli", "esercente", "controparte", "beneficiario",
             "beguenstigter/zahlungspflichtiger", "begünstigter/zahlungspflichtiger", "empfänger", "empfaenger",
             "auftraggeber/empfänger", "name", "payee", "merchant", "description", "verwendungszweck", "beschreibung",
             "buchungstext", "reference", "note", "notes"]
AMOUNT_COLS = ["importo (eur)", "importo", "amount (eur)", "amount", "betrag (eur)", "betrag", "umsatz", "valore"]
OUT_COLS = ["uscite", "addebiti", "addebito", "dare", "soll", "debit", "importo addebitato", "ausgang"]
IN_COLS = ["entrate", "accrediti", "accredito", "avere", "haben", "credit", "eingang"]
INCOME_WORDS = ("accredito", "stipendio", "bonifico a vostro favore", "bonifico a tuo favore", "ricarica da", "rimborso",
                "gutschrift", "eingang", "lohn", "gehalt", "refund", "top-up", "top up", "storno")

DATE_RE = r"(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})"
AMOUNT_RE = r"([-+−]?\s?€?\s?\d{1,3}(?:[.\s']\d{3})*(?:[.,]\d{2})\s?(?:€|EUR)?\s?[-+]?)"


# ---------- numeri e date ----------

def parse_amount(text) -> float | None:
    """'1.234,56' · '-12,30' · '12.30' · '€ 12,30' · '12,30-' → float (con segno)."""
    if text is None:
        return None
    s = str(text).strip().replace("−", "-").replace("€", "").replace("EUR", "").replace(" ", " ").strip()
    if not s:
        return None
    neg = s.startswith("-") or s.endswith("-") or (s.startswith("(") and s.endswith(")"))
    s = s.strip("-+() ").replace(" ", "").replace("'", "")
    if not re.fullmatch(r"\d[\d.,]*", s):
        return None
    if "," in s and "." in s:  # l'ultimo separatore è quello dei decimali
        s = s.replace(".", "").replace(",", ".") if s.rfind(",") > s.rfind(".") else s.replace(",", "")
    elif "," in s:
        s = s.replace(",", ".") if re.search(r",\d{1,2}$", s) else s.replace(",", "")
    elif s.count(".") > 1 or re.search(r"\.\d{3}$", s):
        s = s.replace(".", "")
    try:
        v = float(s)
    except ValueError:
        return None
    return -v if neg else v


def parse_date(text, year_hint: int | None = None) -> dt.date | None:
    s = str(text or "").strip()
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        y, mo, d = (int(x) for x in m.groups())
    else:
        m = re.search(r"(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?", s)
        if not m:
            return None
        d, mo = int(m.group(1)), int(m.group(2))
        y = int(m.group(3)) if m.group(3) else (year_hint or dt.date.today().year)
        if y < 100:
            y += 2000
    try:
        return dt.date(y, mo, d)
    except ValueError:
        return None


# ---------- descrizione ----------

NOISE = re.compile(
    r"\b(pagamento|pagam\.?|pag\.?|pos|carta|card|n\.|nr\.?|num\.?|del|ore|op\.?|operazione|transazione|acquisto|"
    r"addebito|sdd|sepa|lastschrift|kartenzahlung|girocard|visa|mastercard|maestro|debit|contactless|"
    r"apple ?pay|google ?pay|eur|euro|presso|c/o|da|il|in data|data|valuta|riferimento|rif\.?)\b", re.I)


def clean_description(text: str) -> str:
    """'PAGAMENTO POS 12,30 EUR DEL 03.11.2026 ORE 12:31 PRESSO LIDL 1234 CARTA ****5678' → 'Lidl'."""
    s = re.sub(r"\s+", " ", str(text or "")).strip()
    m = re.search(r"\bpresso\s+(.+)", s, re.I) or re.search(r"\bc/o\s+(.+)", s, re.I)
    if m:
        s = m.group(1)
    s = re.sub(r"\*+\d*|x{3,}\d*", " ", s, flags=re.I)          # carte mascherate
    s = re.sub(DATE_RE, " ", s)
    s = re.sub(r"\b\d{1,2}[:.]\d{2}\b", " ", s)                  # orari
    s = re.sub(AMOUNT_RE, " ", s)
    s = re.sub(r"\b[\w-]*\d{4,}[\w-]*\b", " ", s)                # codici lunghi
    s = NOISE.sub(" ", s)
    s = re.sub(r"[|;/_]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip(" -.,:")
    if not s:
        s = re.sub(r"\s+", " ", str(text or "")).strip()[:40]
    words = s.split(" ")[:5]
    s = " ".join(words)
    if s.isupper() or s.islower():
        s = s.title()
    return s[:60]


# ---------- CSV ----------

def _decode(data: bytes) -> str:
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def _find(headers: list[str], names: list[str]) -> int | None:
    for name in names:  # prima i nomi esatti, poi quelli che contengono la parola
        for i, h in enumerate(headers):
            if h == name:
                return i
    for name in names:
        for i, h in enumerate(headers):
            if name in h:
                return i
    return None


def parse_csv(data: bytes) -> list[dict]:
    text = _decode(data)
    lines = [l for l in text.splitlines() if l.strip()]
    sample = "\n".join(lines[:30])
    delim = max([";", ",", "\t", "|"], key=lambda d: sample.count(d))
    rows = list(csv.reader(lines, delimiter=delim))
    # riga di intestazione: la prima che ha una colonna data e una colonna importo/uscite
    head_i = None
    for i, r in enumerate(rows[:40]):
        h = [c.strip().lower() for c in r]
        if _find(h, DATE_COLS) is not None and (_find(h, AMOUNT_COLS) is not None or _find(h, OUT_COLS) is not None):
            head_i = i
            break
    if head_i is None:
        raise ValueError("Non trovo le colonne Data e Importo in questo file CSV")
    headers = [c.strip().lower() for c in rows[head_i]]
    c_date = _find(headers, DATE_COLS)
    c_amount = _find(headers, AMOUNT_COLS)
    c_out, c_in = _find(headers, OUT_COLS), _find(headers, IN_COLS)
    desc_cols = []
    for name in DESC_COLS:  # fino a due colonne di descrizione (es. beneficiario + causale)
        i = _find(headers, [name])
        if i is not None and i not in desc_cols and i not in (c_date, c_amount, c_out, c_in):
            desc_cols.append(i)
        if len(desc_cols) == 2:
            break

    raw = []
    for r in rows[head_i + 1:]:
        if len(r) <= c_date:
            continue
        day = parse_date(r[c_date])
        if not day:
            continue
        if c_out is not None or c_in is not None:
            out = parse_amount(r[c_out]) if c_out is not None and c_out < len(r) else None
            inc = parse_amount(r[c_in]) if c_in is not None and c_in < len(r) else None
            if out:
                amount = -abs(out)
            elif inc:
                amount = abs(inc)
            elif c_amount is not None and c_amount < len(r):
                amount = parse_amount(r[c_amount])
            else:
                continue
        else:
            amount = parse_amount(r[c_amount]) if c_amount < len(r) else None
        if not amount:
            continue
        parts = [r[i].strip() for i in desc_cols if i < len(r) and r[i].strip()]
        # nome = prima colonna utile (es. beneficiario); il testo completo resta in 'original'
        raw.append({"date": day, "original": " · ".join(parts) or "Spesa", "name": parts[0] if parts else "Spesa",
                    "signed": amount})
    return raw


# ---------- PDF ----------

def parse_pdf(data: bytes) -> list[dict]:
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(data))
    text = "\n".join((p.extract_text(extraction_mode="layout") or "") for p in reader.pages)
    if len(text.strip()) < 20:
        raise ValueError("Questo PDF non contiene testo (forse è una foto/scansione): scarica il CSV o un PDF dall'app")
    year = None
    m = re.search(r"\b(20\d{2})\b", text)
    if m:
        year = int(m.group(1))
    line_re = re.compile(rf"^\s*{DATE_RE}(?:\s+{DATE_RE})?\s+(.+?)\s+{AMOUNT_RE}(?:\s+{AMOUNT_RE})?\s*$")
    short_date = re.compile(r"^\s*(\d{1,2}[./]\d{1,2})\.?\s+(.+?)\s+" + AMOUNT_RE + r"\s*$")
    raw, last = [], None
    out_head = re.compile(r"\b(uscite|addebiti|dare|soll|debit|ausgang)\b", re.I)
    in_head = re.compile(r"\b(entrate|accrediti|avere|haben|credit|eingang)\b", re.I)
    cols = None  # (posizione colonna uscite, posizione colonna entrate) dall'intestazione della tabella
    for line in text.splitlines():
        mo, mi = out_head.search(line), in_head.search(line)
        if mo and mi:
            cols = (mo.end(), mi.end())
            continue
        m = line_re.match(line)
        if m:
            day = parse_date(m.group(1), year)
            desc, a1, a2 = m.group(3), m.group(4), m.group(5)
        else:
            m2 = short_date.match(line)
            if m2 and parse_date(m2.group(1), year):
                day, desc, a1, a2 = parse_date(m2.group(1), year), m2.group(2), m2.group(3), None
            else:
                # riga di continuazione: completa la descrizione del movimento precedente
                if last is not None and line.strip() and len(last["original"]) < 120 and not re.search(DATE_RE, line):
                    extra = re.sub(r"\s+", " ", line).strip()
                    if extra and not re.fullmatch(r"[\d\s.,€-]+", extra):
                        last["original"] += " " + extra
                continue
        if not day:
            continue
        # con due importi (es. uscite | entrate o importo | saldo) di solito il primo è il movimento
        amount = parse_amount(a1)
        if amount is None:
            continue
        desc = re.sub(r"\s{2,}", " ", desc).strip()
        if re.search(r"saldo|totale|riporto|kontostand|balance", desc, re.I):
            continue
        signed = amount
        end = line.rstrip().rfind(str(a2 or a1).strip()) + len(str(a2 or a1).strip()) if a2 is None else None
        if cols and end is not None and end > 0:
            # l'importo sta sotto la colonna più vicina (le colonne sono allineate a destra)
            signed = -abs(amount) if abs(end - cols[0]) <= abs(end - cols[1]) else abs(amount)
        elif not str(a1).strip().startswith(("-", "−", "+")) and not str(a1).strip().endswith(("-", "+")):
            signed = abs(amount) if any(w in desc.lower() for w in INCOME_WORDS) else -abs(amount)
        elif str(a1).strip().startswith("+") or str(a1).strip().endswith("+"):
            signed = abs(amount)
        last = {"date": day, "original": desc, "signed": signed}
        raw.append(last)
    if not raw:
        raise ValueError("Non ho trovato movimenti in questo PDF: prova con il file CSV")
    return raw


# ---------- comune ----------

def _to_expenses(raw: list[dict]) -> dict:
    """Decide il segno delle uscite e tiene solo quelle; le entrate vengono solo contate."""
    if not raw:
        return {"items": [], "income": 0}
    neg = sum(1 for r in raw if r["signed"] < 0)
    # estratti della carta: spesso tutti positivi = tutti uscite (tranne rimborsi/accrediti)
    all_positive_are_spend = neg == 0
    out = []
    income = 0
    for r in raw:
        is_spend = r["signed"] < 0 or (all_positive_are_spend and not any(w in r["original"].lower() for w in INCOME_WORDS))
        if not is_spend:
            income += 1
            continue
        out.append({"date": r["date"].isoformat(), "original": r["original"], "description": clean_description(r.get("name") or r["original"]),
                    "amount": round(abs(r["signed"]), 2)})
    out.sort(key=lambda x: x["date"])
    return {"items": out, "income": income}


def parse(filename: str, data: bytes) -> dict:
    name = filename.lower()
    if name.endswith(".pdf") or data[:5] == b"%PDF-":
        return _to_expenses(parse_pdf(data))
    if name.endswith((".csv", ".txt", ".tsv")) or b"," in data[:2000] or b";" in data[:2000]:
        return _to_expenses(parse_csv(data))
    raise ValueError("Formato non riconosciuto: usa un file CSV o PDF")


# ---------- fogli di calcolo fatti a mano (Excel, Numbers, Google Fogli/LibreOffice, CSV senza date) ----------
# Ogni tabella è {name, rows}; le colonne si riconoscono dal nome o dal contenuto. Casi gestiti:
#  - colonne Data / Descrizione / Importo / Categoria (anche in ordine diverso o con nomi diversi);
#  - "a matrice": una colonna per categoria con la cifra nella colonna giusta (es. Totale | Cibo | Svago…);
#    le colonne "Di cui …" sono un dettaglio della categoria accanto (più precise, ma non si sommano);
#  - senza date: il mese viene dal nome della tabella/foglio ("ottobre", "Oct 2025"), giorno 1.
# Celle come "20 (da pagare)" → 20 € con nota "da pagare". Righe senza nome (es. i totali) saltate.

MONTH_WORDS = {
    1: ["gennaio", "january", "januar", "jan", "gen"], 2: ["febbraio", "february", "februar", "feb"],
    3: ["marzo", "march", "märz", "maerz", "mar"], 4: ["aprile", "april", "apr"], 5: ["maggio", "may", "mai", "mag"],
    6: ["giugno", "june", "juni", "jun", "giu"], 7: ["luglio", "july", "juli", "jul", "lug"],
    8: ["agosto", "august", "aug", "ago"], 9: ["settembre", "september", "sept", "sep", "set"],
    10: ["ottobre", "october", "oktober", "oct", "okt", "ott"], 11: ["novembre", "november", "nov"],
    12: ["dicembre", "december", "dezember", "dec", "dez", "dic"],
}
T_DATE = DATE_COLS + ["giorno", "quando", "tag", "day", "when"]
T_AMOUNT = AMOUNT_COLS + ["totale", "total", "tot", "costo", "prezzo", "price", "cost", "kosten", "preis", "summe",
                          "spesa (€)", "€", "eur", "euro", "quanto", "cifra"]
T_CAT = ["categoria", "categorie", "category", "kategorie", "tipo", "type", "gruppo", "genere"]
T_DESC = ["descrizione", "description", "voce", "cosa", "nome", "dettaglio", "dettagli", "articolo", "oggetto", "item",
          "what", "beschreibung", "bezeichnung", "was", "spesa", "causale", "note", "notes"]
T_IN = IN_COLS + ["entrata", "income", "einnahmen", "einnahme"]
SUB_PREFIX = re.compile(r"^\s*(di cui|davon|of which|incl\.?|including)\s+", re.I)
TOTAL_WORDS = re.compile(r"^\s*(totale|totali|total|totals|tot\.?|somma|summe|gesamt|subtotale|subtotal)\b", re.I)


def month_from_name(name: str, today: dt.date | None = None) -> tuple[int, int] | None:
    """'ottobre' → (anno dell'ultimo ottobre non futuro, 10); 'Oct 2025' → (2025, 10)."""
    today = today or dt.date.today()
    low = str(name or "").lower()
    found = None
    for m, words in MONTH_WORDS.items():
        for w in words:
            if re.search(rf"(?<![a-zà-ü]){re.escape(w)}(?![a-zà-ü])", low):
                found = found or m
    if not found:
        return None
    y = re.search(r"\b(20\d{2})\b", low) or re.search(r"(?<!\d)'?(\d{2})\b", low)
    if y:
        year = int(y.group(1))
        year = year + 2000 if year < 100 else year
    else:
        year = today.year if found <= today.month else today.year - 1
    return year, found


def _cell_text(v) -> str:
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()


def _num(v) -> tuple[float | None, str]:
    """Valore numerico di una cella e l'eventuale testo che lo accompagna ('20 (da pagare)' → 20, 'da pagare')."""
    if v is None or isinstance(v, bool):
        return None, ""
    if isinstance(v, (int, float)):
        return float(v), ""
    if isinstance(v, (dt.date, dt.datetime)):
        return None, ""
    s = str(v).strip()
    a = parse_amount(s)
    if a is not None:
        return a, ""
    m = re.match(r"^\s*([-−]?\s?€?\s?\d[\d.,']*)\s*€?\s*(.*)$", s)
    if m:
        a = parse_amount(m.group(1))
        if a is not None:
            return a, m.group(2).strip(" ()[]-–:·")
    return None, ""


def _as_date(v) -> dt.date | None:
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    if isinstance(v, str) and re.search(r"\d", v):
        return parse_date(v)
    return None


def _short(desc: str) -> str:
    d = re.sub(r"\s+", " ", desc).strip()
    if len(d) <= 40:
        return d
    cut = re.split(r"[,(;:]", d)[0].strip()
    if 3 <= len(cut) <= 40:
        return cut
    return " ".join(d.split(" ")[:5])[:40]


def parse_table(name: str, rows: list[list], today: dt.date | None = None) -> dict:
    """Spese di una tabella fatta a mano → {items, income}. items senza data hanno 'nodate'."""
    rows = [list(r)[:40] for r in rows[:5000]]
    width = max((len(r) for r in rows), default=0)
    rows = [r + [None] * (width - len(r)) for r in rows]
    is_text = lambda v: isinstance(v, str) and v.strip() and _num(v)[0] is None and not _as_date(v)

    def numeric_below(i, j):
        return sum(1 for r in rows[i + 1:i + 60] if _num(r[j])[0] is not None)

    head = None
    for i, r in enumerate(rows[:30]):
        texts = [j for j, v in enumerate(r) if is_text(v)]
        if len(texts) >= 2 and any(numeric_below(i, j) for j in texts):
            head = i
            break
    if head is None:
        return {"items": [], "income": 0}
    headers = [_cell_text(v).lower() for v in rows[head]]
    data = rows[head + 1:]

    def find(names, exclude=()):
        j = _find([h if k not in exclude else "" for k, h in enumerate(headers)], names)
        return j if j is not None and headers[j] else None

    c_date = find(T_DATE)
    if c_date is None:  # colonna con tante date anche senza nome
        best = max(range(width), key=lambda j: sum(1 for r in data if _as_date(r[j])), default=None)
        if best is not None and sum(1 for r in data if _as_date(r[best])) >= max(2, len(data) // 3):
            c_date = best
    used = {c_date}
    c_amount = find(T_AMOUNT, used)
    used.add(c_amount)
    c_cat = find(T_CAT, used)
    used.add(c_cat)
    c_in = find(T_IN, used)
    used.add(c_in)
    c_desc = find(T_DESC, used)
    if c_desc is None:  # la colonna con più testo
        cand = [j for j in range(width) if j not in used]
        c_desc = max(cand, key=lambda j: sum(1 for r in data if is_text(r[j])), default=None)
    used.add(c_desc)
    matrix = [j for j in range(width) if j not in used and headers[j] and numeric_below(head, j)]
    main_cols = [j for j in matrix if not SUB_PREFIX.match(headers[j])]
    sub_cols = [j for j in matrix if SUB_PREFIX.match(headers[j])]
    if c_amount is None and not main_cols:
        return {"items": [], "income": 0}

    ym = month_from_name(name, today)
    items, income = [], 0
    for r in data:
        desc = _cell_text(r[c_desc]) if c_desc is not None else ""
        if not desc or TOTAL_WORDS.match(desc) or parse_amount(desc) is not None:
            continue
        notes = []
        if c_amount is not None:
            amount, extra = _num(r[c_amount])
            if extra:
                notes.append(extra)
        else:
            amount = None
        cat = sub = None
        total = 0.0
        for j in main_cols:
            v, extra = _num(r[j])
            if v:
                total += v
                cat = cat or _cell_text(rows[head][j])
                if extra and extra not in notes:
                    notes.append(extra)
        for j in sub_cols:
            v, extra = _num(r[j])
            if v:
                sub = sub or SUB_PREFIX.sub("", _cell_text(rows[head][j])).strip()
                if extra and extra not in notes:
                    notes.append(extra)
        if amount is None:
            amount = total or None
        if c_cat is not None and _cell_text(r[c_cat]):
            cat = _cell_text(r[c_cat])
        if c_in is not None and not amount and _num(r[c_in])[0]:
            income += 1
            continue
        if not amount:
            continue
        if amount < 0:  # in un foglio di spese un numero negativo è un rimborso/entrata
            income += 1
            continue
        day = _as_date(r[c_date]) if c_date is not None else None
        item = {"original": desc, "description": _short(desc), "amount": round(amount, 2),
                "note": " · ".join(notes) or None, "source_category": sub or cat, "src": name}
        if day:
            item["date"] = day.isoformat()
        else:
            y, m = ym or ((today or dt.date.today()).year, (today or dt.date.today()).month)
            item.update(date=dt.date(y, m, 1).isoformat(), nodate=True, month_guess=bool(ym))
        items.append(item)
    return {"items": items, "income": income}


def _xlsx_tables(data: bytes) -> list[tuple[str, list[list]]]:
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True, read_only=True)
    out = []
    for ws in wb.worksheets:
        if getattr(ws, "sheet_state", "visible") != "visible":
            continue
        out.append((ws.title, [list(r) for r in ws.iter_rows(max_row=5000, max_col=40, values_only=True)]))
    return out


def _numbers_tables(data: bytes) -> list[tuple[str, list[list]]]:
    import tempfile
    from numbers_parser import Document
    with tempfile.NamedTemporaryFile(suffix=".numbers") as f:
        f.write(data)
        f.flush()
        doc = Document(f.name)
        out = []
        for sh in doc.sheets:
            for t in sh.tables:
                rows = [list(r) for r in t.iter_rows(values_only=True)]
                out.append((f"{t.name} · {sh.name}", rows))
        return out


def _ods_tables(data: bytes) -> list[tuple[str, list[list]]]:
    import zipfile
    import xml.etree.ElementTree as ET
    ns = {"table": "urn:oasis:names:tc:opendocument:xmlns:table:1.0", "office": "urn:oasis:names:tc:opendocument:xmlns:office:1.0",
          "text": "urn:oasis:names:tc:opendocument:xmlns:text:1.0"}
    q = lambda p, n: "{" + ns[p] + "}" + n
    root = ET.fromstring(zipfile.ZipFile(io.BytesIO(data)).read("content.xml"))
    out = []
    for t in root.iter(q("table", "table")):
        rows = []
        for row in t.iter(q("table", "table-row")):
            cells = []
            for c in row:
                if c.tag not in (q("table", "table-cell"), q("table", "covered-table-cell")):
                    continue
                kind = c.get(q("office", "value-type"))
                if kind in ("float", "currency", "percentage"):
                    v = float(c.get(q("office", "value")))
                elif kind == "date":
                    v = parse_date(c.get(q("office", "date-value"), "")[:10])
                else:
                    v = "\n".join("".join(p.itertext()) for p in c.findall(q("text", "p"))) or None
                n = min(int(c.get(q("table", "number-columns-repeated"), "1")), 40)
                cells += [v] * n
            while cells and cells[-1] in (None, ""):
                cells.pop()
            n = min(int(row.get(q("table", "number-rows-repeated"), "1")), 5000)
            rows += [cells] * (n if cells else min(n, 1))
            if len(rows) > 5000:
                break
        out.append((t.get(q("table", "name"), "Foglio"), rows))
    return out


def parse_ofx(text: str) -> list[dict]:
    raw = []
    for block in re.split(r"<STMTTRN>", text, flags=re.I)[1:]:
        block = re.split(r"</STMTTRN>", block, flags=re.I)[0]
        get = lambda tag: (re.search(rf"<{tag}>\s*([^<\r\n]*)", block, re.I) or [None, ""])[1].strip()
        d = get("DTPOSTED") or get("DTUSER")
        amount = parse_amount(get("TRNAMT").replace(",", "."))
        if not re.match(r"\d{8}", d) or amount is None:
            continue
        name, memo = get("NAME"), get("MEMO")
        raw.append({"date": dt.date(int(d[:4]), int(d[4:6]), int(d[6:8])), "original": " · ".join(x for x in (name, memo) if x) or "Spesa",
                    "name": name or memo or "Spesa", "signed": amount})
    if not raw:
        raise ValueError("Non ho trovato movimenti in questo file OFX")
    return raw


def parse_qif(text: str) -> list[dict]:
    recs, cur = [], {}
    for line in text.splitlines():
        if not line.strip() or line.startswith("!"):
            continue
        if line.startswith("^"):
            if cur:
                recs.append(cur)
            cur = {}
            continue
        cur.setdefault(line[0], line[1:].strip())
    if cur:
        recs.append(cur)
    # ordine giorno/mese: se una data ha il secondo numero > 12 è mese/giorno (formato americano)
    parts = [re.findall(r"\d+", r.get("D", "")) for r in recs]
    us = any(len(p) >= 2 and int(p[1]) > 12 for p in parts) and not any(len(p) >= 2 and int(p[0]) > 12 for p in parts)
    raw = []
    for r, p in zip(recs, parts):
        if len(p) < 3 or "T" not in r and "U" not in r:
            continue
        a, b, y = (int(x) for x in p[:3])
        if len(p[0]) == 4:
            y, a, b = a, b, y  # 2026-10-03
            day, month = b, a
        else:
            day, month = (b, a) if us else (a, b)
        y = y + 2000 if y < 100 else y
        amount = parse_amount(r.get("T") or r.get("U"))
        try:
            date = dt.date(y, month, day)
        except ValueError:
            continue
        if amount is None:
            continue
        name, memo = r.get("P", ""), r.get("M", "")
        raw.append({"date": date, "original": " · ".join(x for x in (name, memo) if x) or "Spesa",
                    "name": name or memo or "Spesa", "signed": amount})
    if not raw:
        raise ValueError("Non ho trovato movimenti in questo file QIF")
    return raw


def _tables_result(tables: list[tuple[str, list[list]]], months: dict | None = None) -> dict:
    items, income, sources = [], 0, []
    for name, rows in tables:
        res = parse_table(name, rows)
        if not res["items"]:
            continue
        override = (months or {}).get(name)
        if override:
            for it in res["items"]:
                if it.get("nodate"):
                    it["date"] = f"{override}-01"
        nod = [it for it in res["items"] if it.get("nodate")]
        if nod:
            sources.append({"src": name, "month": nod[0]["date"][:7], "guess": nod[0]["month_guess"], "count": len(nod)})
        items += res["items"]
        income += res["income"]
    items.sort(key=lambda x: x["date"])
    return {"items": items, "income": income, "sources": sources, "kind": "table"}


def parse_any(filename: str, data: bytes, months: dict | None = None) -> dict:
    """Come `parse`, ma riconosce anche Excel, Numbers, ODS (Google Fogli/LibreOffice), OFX, QIF e i CSV fatti a mano."""
    name = filename.lower()
    if data[:5] == b"%PDF-" or name.endswith(".pdf"):
        return _to_expenses(parse_pdf(data))
    if data[:4] == b"\xd0\xcf\x11\xe0":
        raise ValueError("È un file Excel vecchio (.xls): aprilo e salvalo come .xlsx, poi riprova")
    if data[:2] == b"PK":
        import zipfile
        z = zipfile.ZipFile(io.BytesIO(data))
        names = set(z.namelist())
        if "xl/workbook.xml" in names:
            return _tables_result(_xlsx_tables(data), months)
        if "content.xml" in names and ("mimetype" not in names or b"opendocument.spreadsheet" in z.read("mimetype")):
            return _tables_result(_ods_tables(data), months)
        if any(n.startswith("Index/") for n in names) or name.endswith(".numbers"):
            return _tables_result(_numbers_tables(data), months)
        raise ValueError("Formato non riconosciuto: usa Excel, Numbers, CSV, PDF, OFX o QIF")
    text = _decode(data)
    if re.search(r"<OFX>|OFXHEADER", text[:3000], re.I) or name.endswith(".ofx"):
        return _to_expenses(parse_ofx(text))
    if text.lstrip().startswith("!Type") or name.endswith(".qif"):
        return _to_expenses(parse_qif(text))
    if name.endswith((".csv", ".txt", ".tsv")) or "," in text[:2000] or ";" in text[:2000] or "\t" in text[:2000]:
        try:
            return _to_expenses(parse_csv(data))
        except ValueError:
            lines = [l for l in text.splitlines() if l.strip()]
            delim = max([";", ",", "\t", "|"], key=lambda d: "\n".join(lines[:30]).count(d))
            rows = [[c if c.strip() else None for c in r] for r in csv.reader(lines, delimiter=delim)]
            res = _tables_result([(filename.rsplit(".", 1)[0], rows)], months)
            if res["items"]:
                return res
            raise ValueError("Non trovo le colonne con descrizione e importo in questo file CSV")
    raise ValueError("Formato non riconosciuto: usa Excel, Numbers, CSV, PDF, OFX o QIF")
