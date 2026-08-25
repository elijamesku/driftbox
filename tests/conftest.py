# tests/conftest.py
import sys
from pathlib import Path

# add project root (one level up from tests/) to the import path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
