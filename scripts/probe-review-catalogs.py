"""Explicit public-network probe. Does not create reviews, findings, or image evidence."""
import asyncio
from datetime import datetime, timezone
from dataclasses import replace
import json
from pathlib import Path
import sys
import time

root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root / 'services/catalogs'))
from app.config import Settings
from app.review import bounded_get, run_review, skybot, skybot_table

output = Path(sys.argv[1]) if len(sys.argv) > 1 else root / '.local-test-temp/review-catalog-smoke.json'
saved = json.loads((root / 'fixtures/archive/real/response.json').read_text())['comparison']
position = saved['field']
observed = saved['frames'][0]['observedAtUtc']
start = time.monotonic()
report = run_review(position['ra'], position['dec'], 120, observed, replace(Settings.from_env(), live=True))
record = {'checkedAtUtc': datetime.now(timezone.utc).isoformat(), 'kind': 'live_public_catalog_adapter_probe',
          'note': 'Cone neighbors and Solar System predictions do not establish identity, image detection, or novelty. No review was posted.',
          'elapsedSeconds': round(time.monotonic() - start, 2), 'review': report.model_dump()}
print([(check.catalog, check.status, len(check.rows)) for check in report.checks], flush=True)
# Find a known Solar System record near the service documentation's sample field,
# then exercise the production adapter with an in-range 120 arcsec cone around it.
# The seed query is explicitly separate from any image or candidate review.
url = 'https://ssp.imcce.fr/webservices/skybot/api/conesearch.php'
params = {'RA': 148.666, 'DEC': 16.3833, 'SR': 2, 'TIME': observed, 'MAXREC': 10, 'VERB': 3, 'RESPONSEFORMAT': 'votable', '-observer': '500'}
try:
    content, media = asyncio.run(bounded_get(url, params))
    _, rows, _ = skybot_table(content, media)
    record['skybotSeed'] = {'documentation': 'https://ssp.imcce.fr/webservices/skybot/api/conesearch/', 'query': params, 'rowsReturned': len(rows)}
    if rows:
        row = rows[0]
        ra_key = next(k for k in row if k.lower() == '_raj2000')
        dec_key = next(k for k in row if k.lower() == '_decj2000')
        record['skybotNonEmpty'] = skybot(float(row[ra_key]), float(row[dec_key]), 120, observed).model_dump()
        print('SkyBoT small-cone:', record['skybotNonEmpty']['status'], len(record['skybotNonEmpty']['rows']), flush=True)
except Exception as exc:
    record['skybotProbeError'] = type(exc).__name__ + ': ' + str(exc)
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('Saved', output, flush=True)
