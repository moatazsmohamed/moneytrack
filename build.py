"""Compatibility wrapper: Stage 4 needs the Node build, including authentication pages."""
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent
subprocess.run(["node", "scripts/build.js"], cwd=ROOT, check=True)
