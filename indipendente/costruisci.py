"""Costruisce la versione indipendente (cartella sito/) partendo dall'app con il computer (cartella web/).

    ~/.local/bin/uv run --no-project python indipendente/costruisci.py

L'interfaccia è la stessa (web/index.html, app.js, style.css, i18n.js): qui si cambiano solo le scritte che parlano
del Mac, si aggiungono accesso/account/Excel (src/) e al posto del server sul Mac c'è src/server.js, che risponde
alle stesse chiamate /api/… usando i dati sincronizzati con Supabase (src/store.js).
Da rilanciare ogni volta che cambia qualcosa in web/ o in src/. Il risultato (sito/) è quello che va su Vercel.
"""

from __future__ import annotations

import hashlib
import re
import shutil
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
WEB, SRC, OUT, VENDOR = ROOT / "web", HERE / "src", HERE / "sito", HERE / "vendor"

# librerie usate nel telefono: scaricate una volta e servite dal sito (così funzionano anche senza rete)
LIBS = {
    "supabase.min.js": "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js",
    "xlsx.full.min.js": "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js",
}
OUR_JS = ["store.js", "server.js", "excel.js", "importer.js", "login.js"]

# scritte dell'app da adattare: (testo originale, testo nuovo, obbligatorio)
APP_TEXT = [
    ('toast("Apro il file in Excel")', 'toast("Ho scaricato il file Excel")', True),
    (" · sul telefono, arriva al Mac appena si accende", " · sul telefono, parte appena c'è connessione", True),
    ("Il Mac non è raggiungibile", "Niente connessione", True),
    ("modifica fatta a Mac spento", "modifica fatta senza connessione", True),
    ("modifiche fatte a Mac spento", "modifiche fatte senza connessione", True),
    ("appena il Mac risponde", "appena torna la connessione", False),
    ("appena il Mac è raggiungibile", "appena torna la connessione", False),
    ("spese inviate\"} al Mac", "spese inviate\"} online", False),
    ("Spariscono il suo foglio Excel, le sue spese e le righe nei mesi.", "Spariscono le sue spese, le sue categorie e le righe nei mesi.", True),
]
# scritte della pagina da adattare
HTML_TEXT = [
    ("Le spese di un viaggio finiscono nel suo foglio Excel; il totale entra da solo nella categoria Viaggi del mese.",
     "Le spese di un viaggio restano nel viaggio; il totale entra da solo nella categoria Viaggi del mese."),
]


def need(cond: bool, what: str) -> None:
    if not cond:
        raise SystemExit(f"✗ Non trovo nel file originale: {what}\n  (web/ è cambiato: aggiorna costruisci.py)")


def vendor() -> None:
    VENDOR.mkdir(exist_ok=True)
    for name, url in LIBS.items():
        if not (VENDOR / name).exists():
            print("scarico", url)
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (BudgetApp build)"})
            with urllib.request.urlopen(req, timeout=60) as r:
                (VENDOR / name).write_bytes(r.read())


def main() -> None:
    vendor()
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir()
    (OUT / "vendor").mkdir()

    index = (WEB / "index.html").read_text()
    m = re.search(r'app\.js\?v=(\d+)', index)
    need(bool(m), "app.js?v=N in index.html")
    web_v = m.group(1)

    # file dell'app, copiati (app.js con le scritte adattate)
    app = (WEB / "app.js").read_text()
    for old, new, required in APP_TEXT:
        if required:
            need(old in app, old)
        app = app.replace(old, new)
    (OUT / "app.js").write_text(app)
    for f in ("style.css", "i18n.js", "icon.svg", "icon-180.png", "icon-512.png"):
        shutil.copy(WEB / f, OUT / f)
    shutil.copy(ROOT / "server" / "keywords.json", OUT / "keywords.json")
    for f in OUR_JS + ["extra.css"]:
        shutil.copy(SRC / f, OUT / f)
    shutil.copy(HERE / "config.js", OUT / "config.js")
    for f in LIBS:
        shutil.copy(VENDOR / f, OUT / "vendor" / f)

    # versione dei nostri file: cambia quando cambia il contenuto (così il telefono riscarica)
    h = hashlib.sha1()
    for f in sorted(OUT.rglob("*")):
        if f.is_file():
            h.update(f.read_bytes())
    stamp = h.hexdigest()[:8]

    manifest = (WEB / "manifest.webmanifest").read_text().replace("/static/", "")
    (OUT / "manifest.webmanifest").write_text(manifest)

    # pagina: stessi contenuti, più accesso e impostazioni dell'account
    index = index.replace('href="/static/', 'href="').replace('src="/static/', 'src="').replace('href="/manifest.webmanifest"', 'href="manifest.webmanifest"')
    need("Se il Mac è spento, riaccendilo e riapri l'app una volta: poi riproviamo." in index, "testo di avvio")
    index = index.replace("Se il Mac è spento, riaccendilo e riapri l'app una volta: poi riproviamo.",
                          "Controlla la connessione e riapri l'app.")
    need('<link rel="stylesheet" href="style.css' in index, "style.css")
    index = re.sub(r'(<link rel="stylesheet" href="style\.css\?v=\d+">)', rf'\1\n<link rel="stylesheet" href="extra.css?v={stamp}">', index)
    need("<body>" in index, "<body>")
    index = index.replace("<body>", f'<body data-app="app.js?v={web_v}">\n' + (SRC / "login.html").read_text(), 1)
    cards = re.search(r'\s*<div class="card">\s*<h2>Uso con il Mac spento</h2>.*?<div id="upd-box">.*?</div>\s*</div>\n', index, re.S)
    need(bool(cards), "riquadri 'Uso con il Mac spento' e 'Aggiornamenti' nelle Impostazioni")
    index = index.replace(cards.group(0), "\n" + (SRC / "settings.html").read_text(), 1)
    index = index.replace("(iPhone e Mac si impostano a parte)", "(iPhone e computer si impostano a parte)")
    for old, new in HTML_TEXT:
        need(old in index, old[:60])
        index = index.replace(old, new)
    app_tag = f'<script src="app.js?v={web_v}"></script>'
    need(app_tag in index, app_tag)
    scripts = [f'<script src="config.js?v={stamp}"></script>'] + [f'<script src="vendor/{f}"></script>' for f in LIBS] + \
              [f'<script src="{f}?v={stamp}"></script>' for f in OUR_JS]
    index = index.replace(app_tag, "\n".join(scripts))
    (OUT / "index.html").write_text(index)

    # service worker: lo stesso dell'app ("prima la copia"), con i file di questa versione
    sw = (WEB / "sw.js").read_text()
    shell = ["/", f"/i18n.js?v={web_v}", f"/app.js?v={web_v}", f"/style.css?v={web_v}", f"/extra.css?v={stamp}", f"/config.js?v={stamp}",
             "/manifest.webmanifest", "/icon.svg", "/icon-180.png", "/icon-512.png", "/keywords.json"] + \
            [f"/vendor/{f}" for f in LIBS] + [f"/{f}?v={stamp}" for f in OUR_JS]
    sw = re.sub(r'const CACHE = "[^"]+";', f'const CACHE = "spese-indip-{stamp}";', sw)
    sw, n = re.subn(r"const SHELL = \[[^\]]*\];", "const SHELL = " + str(shell).replace("'", '"') + ";", sw)
    need(n == 1, "const SHELL in sw.js")
    (OUT / "sw.js").write_text(sw)
    print(f"✓ sito/ pronto (app v{web_v}, versione {stamp})")


if __name__ == "__main__":
    main()
