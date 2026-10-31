"""Add or change interface texts in all five dictionaries at once.

Usage: python scripts/i18n-add.py path/to/keys.py

keys.py defines two dicts, each mapping a key to (en, ru, uk, de, es):
    K   = {"some.new": ("Text", "Текст", "Текст", "Text", "Texto")}   # new keys (appended)
    FIX = {"some.old": ("New text", ...)}                               # existing keys (replaced)
"""

import importlib.util
import json
import re
import sys
from pathlib import Path

LANGS = ["en", "ru", "uk", "de", "es"]
I18N = Path(__file__).resolve().parent.parent / "apps" / "web" / "src" / "i18n"

spec = importlib.util.spec_from_file_location("keys", sys.argv[1])
keys = importlib.util.module_from_spec(spec)
spec.loader.exec_module(keys)
new = dict(getattr(keys, "K", {}))
fix = dict(getattr(keys, "FIX", {}))

for i, lang in enumerate(LANGS):
    path = I18N / f"{lang}.ts"
    text = path.read_text(encoding="utf-8")
    for key, values in {**fix, **new}.items():
        line = re.compile(r'^(\s*)"' + re.escape(key) + r'": .*,$', re.M)
        value = json.dumps(values[i], ensure_ascii=False)
        if line.search(text):
            text = line.sub(lambda m: f'{m.group(1)}"{key}": {value},', text)
        else:
            end = text.rindex("}")
            text = text[:end].rstrip() + f'\n  "{key}": {value},\n' + text[end:]
    path.write_text(text, encoding="utf-8")
print("ok")
