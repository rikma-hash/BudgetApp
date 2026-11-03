"""Assistente budget e analisi dei risparmi, a partire dai dati dei mesi passati."""

from __future__ import annotations

import datetime as dt
import statistics
from collections import defaultdict

from . import excel as X
from .suggest import Suggester, normalize

FIXED = {"affitto"}           # spese fisse: si propone l'ultimo importo pagato
SUBSCRIPTIONS = {"abbonamenti"}
SMALL = 5.0                   # soglia "piccole spese"
# spese essenziali: compaiono nell'analisi ma non nei consigli "taglia del 30%"
ESSENTIAL = {"spesa", "mensa", "lavatrici/asciugatrice", "affitto", "abbonamenti"}


def _round5(x: float) -> float:
    return float(max(0, round(x / 5) * 5))


def _month_key(ws) -> dt.date | None:
    dates = [dt.date.fromisoformat(t["date"]) for t in X.transactions(ws) if t["date"]]
    return min(dates).replace(day=1) if dates else None


def past_months(wb, before: str | None = None) -> list[dict]:
    """Mesi conclusi (con spese), in ordine, esclusi il mese `before` e quelli successivi."""
    out = []
    current = X.sheet_for(wb, dt.date.today())
    for ws in X.month_sheets(wb):
        if ws.title == before:
            break
        if ws is current:  # mese in corso: incompleto, abbasserebbe le medie
            continue
        s = X.summary(ws)
        if s["total"] > 0:
            out.append({"sheet": ws.title, "summary": s,
                        "by_cat": {c["category"].casefold(): c["total"] for c in s["categories"]}})
    return out


def subscriptions(wb) -> list[dict]:
    ws = wb[X.TEMPLATE]
    out = []
    for r in range(X.SUB_FIRST, X.SUB_LAST + 1):
        name, amount = ws.cell(r, 8).value, ws.cell(r, 9).value
        if name and isinstance(amount, (int, float)):
            out.append({"name": str(name), "amount": float(amount)})
    return out


def propose(wb, sheet: str, save_rate: float = 0.1, use_carry: bool = False, history_months: int = 3) -> dict:
    """Proposta di budget. Per le spese variabili restituisce anche il valore 'raw' (media storica),
    così l'app può ricalcolare subito la proposta quando cambi entrate, riporto o obiettivo."""
    ws = wb[sheet]
    current = dict(X.budget_table(ws))
    inc = X.income(ws)
    months = past_months(wb, before=sheet)[-history_months:]
    carry = X.carry_before(wb, sheet)
    carry_used = carry if use_carry else 0.0
    target = inc["base"] * (1 - save_rate) + carry_used
    subs_total = round(sum(s["amount"] for s in subscriptions(wb)), 2)

    rows, fixed_total, raw_total = [], 0.0, 0.0
    for cat, budget in current.items():
        key = cat.casefold()
        hist = [m["by_cat"].get(key, 0.0) for m in months]
        avg = statistics.mean(hist) if hist else 0.0
        over = sum(1 for m in months for c in m["summary"]["categories"]
                   if c["category"].casefold() == key and c["budget"] > 0 and c["total"] > c["budget"])
        row = {"category": cat, "current": budget, "avg": round(avg, 2), "last": round(hist[-1] if hist else 0.0, 2),
               "months_over": over, "kind": "variabile"}
        if key in FIXED:
            row["kind"], row["proposal"] = "fissa", _round5(max(row["last"], budget, avg))
            fixed_total += row["proposal"]
        elif key in SUBSCRIPTIONS:
            row["kind"], row["proposal"] = "abbonamenti", float(round(max(subs_total, avg, budget)))
            fixed_total += row["proposal"]
        else:
            row["raw"] = round(avg if avg > 0 else budget, 2)
            raw_total += row["raw"]
        rows.append(row)

    scale = max(0.0, target - fixed_total) / raw_total if raw_total else 0.0
    for row in rows:
        if "raw" in row:
            row["proposal"] = _round5(row["raw"] * scale)
    return {"sheet": sheet, "income": inc, "save_rate": save_rate, "carry": carry, "carry_included": X.carry_included(ws),
            "target": round(target, 2), "rows": rows, "total": round(sum(r["proposal"] for r in rows), 2),
            "avg_total": round(sum(r["avg"] for r in rows), 2), "history_used": [m["sheet"] for m in months]}


LUMPY = FIXED | SUBSCRIPTIONS | {"viaggi"}  # spese a blocchi: il "ritmo" giornaliero non ha senso


def _it(x: float, decimals: int = 2) -> str:
    """Numero all'italiana: 40,15 · 3 (senza ',0')."""
    out = f"{x:.{decimals}f}".replace(".", ",")
    return out.removesuffix(",0") if decimals == 1 else out


def _items(txs: list[dict], limit: int = 5) -> list[dict]:
    """Le voci più pesanti di un gruppo di spese, con quante volte e quanto in tutto."""
    by: dict[str, list[float]] = defaultdict(list)
    for t in txs:
        by[t["description"].strip().capitalize()].append(t["amount"])
    rows = sorted(by.items(), key=lambda kv: -sum(kv[1]))[:limit]
    return [{"name": k, "count": len(v), "total": round(sum(v), 2)} for k, v in rows]


def _by_month(txs: list[dict], sheets: list[str]) -> list[dict]:
    tot = defaultdict(float)
    for t in txs:
        tot[t["sheet"]] += t["amount"]
    return [{"sheet": s, "total": round(tot[s], 2)} for s in sheets]


def current_pace(wb, today: dt.date | None = None) -> dict | None:
    """Mese in corso: per ogni categoria quanto hai speso, quanto resta e dove arrivi al ritmo attuale."""
    today = today or dt.date.today()
    ws = X.sheet_for(wb, today)
    if ws is None:
        return None
    days = (today.replace(day=28) + dt.timedelta(days=4)).replace(day=1) - dt.timedelta(days=1)
    days, day = days.day, today.day
    rows = []
    for c in X.summary(ws)["categories"]:
        if not c["budget"] and not c["total"]:
            continue
        lumpy = c["category"].casefold() in LUMPY
        projected = c["total"] if lumpy or day < 7 else c["total"] / day * days
        left = c["budget"] - c["total"]
        rows.append({"category": c["category"], "budget": c["budget"], "total": c["total"],
                     "used": round(c["total"] / c["budget"], 3) if c["budget"] else None,
                     "projected": round(projected, 2), "lumpy": lumpy,
                     "per_day": round(left / (days - day + 1), 2) if left > 0 else 0.0})
    return {"sheet": ws.title, "day": day, "days": days, "reliable": day >= 7, "categories": rows}


def insights(wb, suggester: Suggester) -> dict:
    year = X.year(wb)
    today = dt.date.today()
    current = X.MONTHS[today.month - 1]
    closed = [m for m in year["months"] if m["month"] != current and m["spent"] > 0]
    saved_closed = round(sum(m["saved"] for m in closed), 2)
    income_closed = sum(m["income"] for m in closed)

    # medie calcolate solo sui mesi conclusi (il mese in corso abbasserebbe le medie)
    closed_sheets = [m["sheet"] for m in closed if m["sheet"]]
    txs = [t for t in X.history(wb) if t["sheet"] in closed_sheets and not t.get("trip")]
    n_months = max(1, len(closed_sheets))

    # temi di spesa trasversali alle categorie (fast food, trasporti, ...)
    theme_txs: dict[str, list[dict]] = defaultdict(list)
    for t in txs:
        if (t["category"] or "").casefold() in FIXED:
            continue
        kw = Suggester._from_keywords(normalize(t["description"]))
        theme = max(kw, key=kw.get) if kw else (t["category"] or "Altro").capitalize()
        theme_txs[theme].append(t)
    themes = sorted(((k, sum(t["amount"] for t in v)) for k, v in theme_txs.items()), key=lambda kv: -kv[1])[:6]

    def theme_detail(theme: str) -> dict:
        tt = theme_txs[theme]
        return {"count": len(tt), "per_month_count": round(len(tt) / n_months, 1),
                "avg_ticket": round(sum(t["amount"] for t in tt) / len(tt), 2) if tt else 0,
                "items": _items(tt), "months": _by_month(tt, closed_sheets)}

    # spese ricorrenti per descrizione
    by_desc: dict[str, list[float]] = defaultdict(list)
    for t in txs:
        if (t["category"] or "").casefold() not in FIXED:
            by_desc[normalize(t["description"])].append(t["amount"])
    recurring = sorted(((d, len(a), sum(a)) for d, a in by_desc.items() if len(a) >= 3), key=lambda x: -x[2])[:6]

    small = [t for t in txs if t["amount"] < SMALL]
    subs = subscriptions(wb)
    subs_total = sum(s["amount"] for s in subs)

    tips = []
    for theme, amount in [kv for kv in themes if kv[0].casefold() not in ESSENTIAL][:3]:
        monthly = amount / n_months
        d = theme_detail(theme)
        tips.append({"title": theme, "monthly": round(monthly, 2), "saving": round(monthly * 0.3, 2),
                     "text": f"In media {monthly:.0f} €/mese. Riducendo del 30% risparmi circa {monthly * 0.3:.0f} €/mese "
                             f"({monthly * 0.3 * 12:.0f} € in un anno).",
                     "how": f"Sono circa {_it(d['per_month_count'], 1)} spese al mese da {_it(d['avg_ticket'])} € in media. "
                            f"Basta farne {max(1, round(d['per_month_count'] * 0.3))} in meno al mese.",
                     "top": [i["name"] for i in d["items"][:4]], **d})
    if small:
        tot = sum(t["amount"] for t in small)
        tips.append({"title": "Piccole spese (sotto 5 €)", "monthly": round(tot / n_months, 2), "saving": round(tot / n_months * 0.3, 2),
                     "text": f"{len(small)} spese per {tot:.0f} € in totale: sembrano poco, ma sono "
                             f"{tot / n_months:.0f} €/mese.",
                     "how": "Caffè, snack e bibite: sono quelle che non si notano. Prova a segnarle tutte per un mese.",
                     "top": [], "count": len(small), "per_month_count": round(len(small) / n_months, 1),
                     "avg_ticket": round(tot / len(small), 2), "items": _items(small), "months": _by_month(small, closed_sheets)})
    if subs:
        tips.append({"title": "Abbonamenti", "monthly": round(subs_total, 2), "saving": 0,
                     "text": f"{subs_total:.2f} €/mese, cioè {subs_total * 12:.0f} € l'anno. Controlla se li usi tutti.",
                     "how": "Per ognuno chiediti: l'ho usato questo mese? Se no, sospenderlo è il risparmio più facile.",
                     "top": [f"{s['name']} {s['amount']:.2f} €" for s in subs],
                     "items": [{"name": s["name"], "count": 12, "total": round(s["amount"] * 12, 2)} for s in subs],
                     "items_label": "in un anno", "months": []})

    # consigli sul budget: categorie sempre sforate (budget irrealistico) o sempre sotto (budget da liberare)
    per_cat: dict[str, list[dict]] = defaultdict(list)
    names: dict[str, str] = {}
    for m in closed:
        if not m["sheet"]:
            continue
        for c in X.summary(wb[m["sheet"]])["categories"]:
            if c["budget"] > 0:
                key = c["category"].casefold()
                names.setdefault(key, c["category"])
                per_cat[key].append({"sheet": m["sheet"], "budget": c["budget"], "total": c["total"]})
    over = defaultdict(int)
    budget_tips = []
    for key, ms in per_cat.items():
        n_over = sum(1 for x in ms if x["total"] > x["budget"])
        if n_over:
            over[names[key].capitalize()] = n_over
        avg_spent = statistics.mean(x["total"] for x in ms)
        avg_budget = statistics.mean(x["budget"] for x in ms)
        if key in FIXED:
            continue
        if n_over >= 2 or (len(ms) == 1 and n_over and avg_spent > avg_budget * 1.2):
            budget_tips.append({"category": names[key], "kind": "alza", "months_over": n_over, "months": ms,
                                "avg_spent": round(avg_spent, 2), "avg_budget": round(avg_budget, 2),
                                "suggest": _round5(avg_spent)})
        elif all(x["total"] < x["budget"] * 0.7 for x in ms) and avg_budget - avg_spent >= 10:
            budget_tips.append({"category": names[key], "kind": "abbassa", "months_over": 0, "months": ms,
                                "avg_spent": round(avg_spent, 2), "avg_budget": round(avg_budget, 2),
                                "suggest": _round5(avg_spent * 1.1)})
    budget_tips.sort(key=lambda b: -abs(b["avg_spent"] - b["avg_budget"]))

    return {
        "months": year["months"],
        "current_month": current,
        "saved_closed": saved_closed,
        "saving_rate": round(saved_closed / income_closed, 3) if income_closed else 0,
        "avg_saved": round(saved_closed / len(closed), 2) if closed else 0,
        "themes": [{"theme": k, "total": round(v, 2), "monthly": round(v / n_months, 2), **theme_detail(k)} for k, v in themes],
        "recurring": [{"description": d, "count": n, "total": round(s, 2)} for d, n, s in recurring],
        "over_budget": sorted(({"category": k, "months": v} for k, v in over.items()), key=lambda x: -x["months"]),
        "tips": tips,
        "budget_tips": budget_tips[:5],
        "pace": current_pace(wb, today),
        "closed_months": closed_sheets,
    }


ADVICE_CONTEXT = "una persona che tiene un budget personale mese per mese"  # sostituito da data/contesto.txt se c'è
ADVICE_PROMPT = """Sei un consulente di finanza personale per {context}. Ecco i suoi dati (JSON):
{data}

Scrivi in italiano, in modo diretto e concreto, al massimo 8 punti brevi:
- come sta andando (risparmio, deficit);
- 3-4 azioni specifiche per risparmiare, con cifre stimate in €/mese, basate sulle sue spese reali;
- un consiglio sul budget del prossimo mese.
Niente premesse, niente consigli d'investimento."""
