"""Copy the self-contained vanilla web app into static deployment output."""
from pathlib import Path
import shutil
ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'dist'
if OUT.exists():
    shutil.rmtree(OUT)
OUT.mkdir()
for name in ('index.html', 'css', 'js', 'assets', 'manus-routes.json'):
    src = ROOT / name
    if src.is_dir():
        shutil.copytree(src, OUT / name)
    else:
        shutil.copy2(src, OUT / name)
print('MoneyTrack static build ready: dist/')
