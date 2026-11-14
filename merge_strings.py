"""Merge paired English/Arabic module strings into the shared dictionary."""
from pathlib import Path
import json
ROOT = Path(__file__).resolve().parent
path = ROOT / 'js/translations.js'
text = path.read_text()
marker = '// Generated workspace strings — edit js/workspace-strings.json, then run merge_strings.py.'
if marker in text:
    text = text[:text.index(marker)].rstrip() + '\n'
strings = {}
for name in ('finance-strings.json', 'workspace-strings.json', 'extra-strings.json'):
    strings.update(json.loads((ROOT / 'js' / name).read_text()))
optional = ROOT / 'js' / 'station2-strings.json'
if optional.exists():
    strings.update(json.loads(optional.read_text()))
for locale in ('en', 'ar'):
    pairs = {key: value[locale] for key, value in strings.items()}
    if locale == 'en': text += '\n' + marker + '\n'
    text += f'Object.assign(translations.{locale}, ' + json.dumps(pairs, ensure_ascii=False, indent=2) + ');\n'
path.write_text(text)
print(f'Merged {len(strings)} bilingual keys.')
