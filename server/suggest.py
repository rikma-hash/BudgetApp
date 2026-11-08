"""Suggerimento della categoria: storico + parole chiave + Claude (abbonamento o API)."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from collections import Counter, defaultdict
from pathlib import Path

from rapidfuzz import fuzz, process

HERE = Path(__file__).resolve().parent
KEYWORDS = json.loads((HERE / "keywords.json").read_text())
# parole chiave personali (es. la mensa della propria università): in data/, quindi mai su GitHub
_LOCAL_KW = Path(os.environ.get("BUDGET_DATA", HERE.parent / "data")) / "keywords_local.json"
_CONTEXT = _LOCAL_KW.parent / "contesto.txt"  # una frase su chi usa l'app (facoltativa, mai su GitHub)


def context(default: str = "una persona che tiene un budget personale mese per mese") -> str:
    try:
        return _CONTEXT.read_text().strip() or default
    except OSError:
        return default
if _LOCAL_KW.exists():
    for _cat, _words in json.loads(_LOCAL_KW.read_text()).items():
        KEYWORDS.setdefault(_cat, []).extend(w for w in _words if w not in KEYWORDS[_cat])

# BUDGET_AI = "cli" (Claude Code con il tuo abbonamento), "api" (ANTHROPIC_API_KEY) oppure "off"
AI_MODE = os.environ.get("BUDGET_AI", "cli")
AI_MODEL = os.environ.get("BUDGET_AI_MODEL", "claude-haiku-5-5")
CONFIDENT = 0.8  # sopra questa soglia non si interpella l'IA


def normalize(text: str) -> str:
    text = text.casefold().strip()
    text = re.sub(r"\(.*?\)", " ", text)       # "Penny (pollo, tonno)" -> "penny"
    text = re.sub(r"[^\w&äöüß ]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


class Suggester:
    def __init__(self, learned_path: Path):
        self.learned_path = learned_path
        self.learned: dict[str, str] = json.loads(learned_path.read_text()) if learned_path.exists() else {}
        self.index: dict[str, Counter] = defaultdict(Counter)

    # ---------- dati ----------

    def load_history(self, history: list[dict], known: list[str]) -> None:
        self.index.clear()
        lookup = {k.casefold(): k for k in known}
        for t in history:
            cat = lookup.get((t.get("category") or "").casefold())
            if cat:
                self.index[normalize(t["description"])][cat] += 1

    def learn(self, description: str, category: str) -> None:
        key = normalize(description)
        self.learned[key] = category
        self.index[key][category] += 1
        self.learned_path.parent.mkdir(parents=True, exist_ok=True)
        self.learned_path.write_text(json.dumps(self.learned, ensure_ascii=False, indent=1, sort_keys=True))

    def rename_category(self, old: str, new: str) -> None:
        """Dopo aver rinominato/eliminato una categoria, le correzioni ricordate puntano a quella nuova."""
        changed = False
        for key, cat in self.learned.items():
            if cat.casefold() == old.casefold():
                self.learned[key] = new
                changed = True
        if changed:
            self.learned_path.write_text(json.dumps(self.learned, ensure_ascii=False, indent=1, sort_keys=True))

    def descriptions(self) -> list[str]:
        return sorted(self.index)

    # ---------- strati ----------

    def _from_history(self, key: str) -> dict[str, float]:
        scores: dict[str, float] = {}
        if key in self.learned:
            scores[self.learned[key]] = 1.0
        if key in self.index:
            counts = self.index[key]
            total = sum(counts.values())
            for cat, n in counts.items():
                scores[cat] = max(scores.get(cat, 0), 0.6 + 0.35 * n / total)
        if not self.index:
            return scores
        for match, sim, _ in process.extract(key, list(self.index), scorer=fuzz.token_set_ratio, limit=5):
            if sim < 80 or match == key:
                continue
            counts = self.index[match]
            total = sum(counts.values())
            for cat, n in counts.items():
                s = (sim / 100) * 0.85 * n / total
                scores[cat] = max(scores.get(cat, 0), s)
        return scores

    @staticmethod
    def _from_keywords(key: str) -> dict[str, float]:
        scores: dict[str, float] = {}
        padded = f" {key} "
        for cat, words in KEYWORDS.items():
            for w in words:
                w = w.casefold()
                if f" {w.strip()} " in padded or (len(w) > 4 and w.strip() in key):
                    # a parità vince la parola più lunga, cioè più precisa ("carnet" batte "carne")
                    scores[cat] = max(scores.get(cat, 0), (0.75 if len(w) > 3 else 0.6) + min(len(w.strip()), 30) / 1000)
        return scores

    def suggest(self, description: str, known: list[str], use_ai: bool = True) -> dict:
        key = normalize(description)
        known_cf = {k.casefold(): k for k in known}
        merged: dict[str, dict] = {}

        def add(cat: str, score: float, source: str):
            canon = known_cf.get(cat.casefold(), cat)
            cur = merged.get(canon)
            if cur is None or score > cur["score"]:
                merged[canon] = {"category": canon, "score": round(score, 2), "source": source,
                                 "new": canon.casefold() not in known_cf}

        if key:
            for c, s in self._from_history(key).items():
                add(c, s, "storico")
            for c, s in self._from_keywords(key).items():
                # una categoria nuova suggerita dalle parole chiave pesa un po' meno di una esistente
                add(c, s if c.casefold() in known_cf else s - 0.05, "parole chiave")

        best = max((m["score"] for m in merged.values()), default=0)
        ai_used = False
        if use_ai and key and best < CONFIDENT and AI_MODE != "off":
            ai = ask_claude(description, known, self._examples())
            if ai:
                ai_used = True
                add(ai["category"], 0.9 if not ai["new"] else 0.85, "Claude")

        ranked = sorted(merged.values(), key=lambda m: (-m["score"], m["new"]))[:3]
        return {"description": description, "suggestions": ranked, "ai_used": ai_used}

    def _examples(self, n: int = 40) -> list[tuple[str, str]]:
        items = [(d, c.most_common(1)[0][0]) for d, c in self.index.items()]
        return items[:n]


# ---------- Claude ----------

PROMPT = """Classifica una spesa personale di {context}.
Categorie esistenti: {cats}
Esempi passati (descrizione -> categoria):
{examples}

Spesa: "{desc}"

Se una categoria esistente va bene, usala. Se nessuna va davvero bene, proponi UNA categoria nuova
breve e generica in italiano (es. "Trasporti", "Cura personale", "Casa"), non troppo specifica.
Rispondi SOLO con JSON: {{"category": "...", "new": true|false}}"""


def ask_claude(description: str, known: list[str], examples: list[tuple[str, str]]) -> dict | None:
    prompt = PROMPT.format(context=context(), cats=", ".join(known), desc=description,
                           examples="\n".join(f"- {d} -> {c}" for d, c in examples))
    text = ask_text(prompt)
    if not text:
        return None
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return None
    data = json.loads(m.group(0))
    cat = str(data.get("category", "")).strip()
    if not cat:
        return None
    is_new = cat.casefold() not in {k.casefold() for k in known}
    return {"category": cat, "new": is_new}


def ask_text(prompt: str, model: str = "haiku", max_tokens: int = 150, timeout: int = 60) -> str | None:
    """Testo libero da Claude; None se l'IA è spenta o non risponde (l'app funziona anche senza)."""
    try:
        if AI_MODE == "cli":
            return _ask_cli(prompt, model, timeout)
        if AI_MODE == "api":
            return _ask_api(prompt, max_tokens)
    except Exception as e:
        print("Claude non disponibile:", e)
    return None


def claude_cli() -> str | None:
    return shutil.which("claude") or next(
        (str(p) for p in (Path.home() / ".local/bin/claude", Path.home() / ".claude/local/claude") if p.exists()), None)


def _ask_cli(prompt: str, model: str = "haiku", timeout: int = 60) -> str | None:
    """Usa Claude Code in modalità non interattiva: consuma il tuo abbonamento, niente chiave API."""
    exe = claude_cli()
    if not exe:
        return None
    env = {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"}  # forza il login dell'abbonamento
    out = subprocess.run([exe, "-p", prompt, "--model", model, "--output-format", "json"],
                         capture_output=True, text=True, timeout=timeout, env=env, cwd=str(HERE))
    if out.returncode != 0:
        raise RuntimeError(out.stderr.strip()[:300])
    return json.loads(out.stdout).get("result")


def _ask_api(prompt: str, max_tokens: int = 150) -> str | None:
    import anthropic

    client = anthropic.Anthropic()
    msg = client.messages.create(model=AI_MODEL, max_tokens=max_tokens, messages=[{"role": "user", "content": prompt}])
    return msg.content[0].text
