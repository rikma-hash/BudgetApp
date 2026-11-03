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
