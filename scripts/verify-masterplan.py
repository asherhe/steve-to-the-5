"""Local completion checks. Browser services are simulated; no credentials are read."""
from pathlib import Path
import argparse
import os
import subprocess
import sys

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('--browser-url', help='Also test an already running production preview, e.g. http://127.0.0.1:5188')
args = parser.parse_args()
npm = 'npm.cmd' if os.name == 'nt' else 'npm'
commands = [
    [sys.executable, str(root / 'scripts/verify-masterplan-checkpoint.py')],
    [npm, '--prefix', 'web', 'run', 'typecheck'],
    [npm, '--prefix', 'web', 'test'],
    ['node', '--test', *[str(p) for p in sorted((root / 'web/src/viewer').glob('*.test.mjs'))]],
]
if args.browser_url:
    commands.append(['node', 'web/src/viewer/local-demo.browser.mjs'])
env = {**os.environ}
if args.browser_url:
    env['VIEWER_TEST_URL'] = args.browser_url
for command in commands:
    print('Running ' + ' '.join(command), flush=True)
    result = subprocess.run(command, cwd=root, env=env)
    if result.returncode:
        sys.exit(result.returncode)
print('Local checks passed. Supabase activation and real two-session auth checks remain separate.')
