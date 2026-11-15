"""Run the checkpoint's offline checks from any working directory. Never uses credentials."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parent.parent
windows = os.name == "nt"


def python_for(service):
    path = root / "services" / service / ".venv" / ("Scripts/python.exe" if windows else "bin/python")
    if not path.is_file():
        raise SystemExit(f"Missing {path}. Follow MASTERPLAN-HANDOFF.md setup instructions.")
    return str(path)


catalog_python = python_for("catalogs")
findings_path = root / "services/findings/.venv" / ("Scripts/python.exe" if windows else "bin/python")
findings_python = str(findings_path) if findings_path.is_file() else python_for("archive")
if not (root / "services/findings/.venv/node_modules/@electric-sql/pglite").is_dir():
    raise SystemExit("Install the declared PGlite dependency first; see MASTERPLAN-HANDOFF.md. Database checks must not skip.")

temp_root = root / ".local-test-temp"
temp_root.mkdir(exist_ok=True)
temp = tempfile.mkdtemp(prefix="catalog-checkpoint-", dir=temp_root)
commands = [
    [catalog_python, "-m", "pytest", "services/catalogs/tests", "-o", "addopts=", "-q", "-p", "no:cacheprovider", "--basetemp", temp],
    ["node", "services/findings/tests/check_migration.cjs"],
    [findings_python, "-m", "unittest", "discover", "-s", "services/findings/tests", "-p", "test_*.py", "-q"],
    ["npm.cmd" if windows else "npm", "run", "build"],
    ["git", "diff", "--check"],
]
for command in commands:
    print("Running " + " ".join(command), flush=True)
    result = subprocess.run(command, cwd=root)
    if result.returncode:
        sys.exit(result.returncode)
print("Backend checkpoint checks passed. Hosted auth, live catalog success and browser integration are separate checks.")
