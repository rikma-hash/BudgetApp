"""Pagamenti che si ripetono (es. 50 € ogni 3 mesi dal 10 gennaio, fino a dicembre o per 4 volte).

Una regola nasce salvando una spesa con "Ripeti": la prima volta è quella spesa; le volte dopo vengono
inserite da sole quando arriva il loro giorno (worker ogni 30 min). `last` = data dell'ultima volta inserita:
la prossima è la prima data della serie dopo `last`, così cambiare la regola non reinserisce niente.
"""
from __future__ import annotations

import datetime as dt
from typing import Iterator

UNITS = ("day", "week", "month", "year")
LIMIT = 2000  # massimo di volte generate (protezione)


def _add_months(day: dt.date, n: int) -> dt.date:
    y, m = divmod(day.month - 1 + n, 12)
    first = dt.date(day.year + y, m + 1, 1)
    last = ((first.replace(day=28) + dt.timedelta(days=4)).replace(day=1) - dt.timedelta(days=1)).day
    return first.replace(day=min(day.day, last))


def _date(v) -> dt.date | None:
    if isinstance(v, dt.date):
        return v
    return dt.date.fromisoformat(v) if v else None


def series(rule: dict) -> Iterator[tuple[int, dt.date]]:
    """(numero della volta, a partire da 1; data) di tutte le volte della regola, rispettando la fine."""
    start = _date(rule["start"])
    every = max(1, int(rule.get("every") or 1))
    unit = rule.get("unit") or "month"
    end = rule.get("end") or "never"
    until = _date(rule.get("until")) if end == "date" else None
    count = int(rule.get("count") or 0) if end == "count" else 0

    def raw() -> Iterator[dt.date]:
        if unit == "day":
            k = 0
            while True:
                yield start + dt.timedelta(days=every * k)
                k += 1
        elif unit == "week":
            days = sorted({int(d) % 7 for d in (rule.get("days") or [])}) or [start.weekday()]
            monday = start - dt.timedelta(days=start.weekday())
            k = 0
            while True:
                base = monday + dt.timedelta(weeks=every * k)
                for d in days:
                    day = base + dt.timedelta(days=d)
                    if day >= start:
                        yield day
                k += 1
        elif unit == "year":
            k = 0
            while True:
                yield _add_months(start, 12 * every * k)
                k += 1
        else:
            k = 0
            while True:
                yield _add_months(start, every * k)
                k += 1

    for i, day in enumerate(raw(), 1):
        if i > LIMIT or (count and i > count) or (until and day > until):
            return
        yield i, day


def due(rule: dict, today: dt.date) -> list[dt.date]:
    """Volte da inserire adesso: dopo `last` e non oltre oggi."""
    last = _date(rule.get("last"))
    out = []
    for _, day in series(rule):
        if day > today:
            break
        if last is None or day > last:
            out.append(day)
    return out


def upcoming(rule: dict, after: dt.date, before: dt.date) -> list[dt.date]:
    """Volte previste (non ancora inserite) tra `after` (escluso) e `before` (escluso)."""
    last = _date(rule.get("last"))
    out = []
    for _, day in series(rule):
        if day >= before:
            break
        if day > after and (last is None or day > last):
            out.append(day)
    return out


def next_date(rule: dict) -> dt.date | None:
    last = _date(rule.get("last"))
    for _, day in series(rule):
        if last is None or day > last:
            return day
    return None


def note(rule: dict) -> str:
    """Nota scritta nelle spese inserite da sole."""
    n = int(rule.get("every") or 1)
    names = {"day": ("giorno", "giorni"), "week": ("settimana", "settimane"),
             "month": ("mese", "mesi"), "year": ("anno", "anni")}[rule.get("unit") or "month"]
    every = f"ogni {names[0]}" if n == 1 else f"ogni {n} {names[1]}"
    base = f"🔁 Si ripete {every}"
    return base + (f" · {rule['note']}" if rule.get("note") else "")
