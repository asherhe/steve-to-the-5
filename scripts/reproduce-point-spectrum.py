"""Recompute retained measurements using saved settings; never downloads replacements."""
import argparse
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from services.findings import spectral
from services.findings.cutouts import Frame, SourceResult
from services.findings.spectral_store import SpectralStore

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('evidence_id')
parser.add_argument('--store', default='services/findings/.local-data/spectral')
args = parser.parse_args()
store = SpectralStore(args.store)
manifest = json.loads(store.read(args.evidence_id, '.json'))
saved = manifest['report']
if saved['config']['implementationSha256'] != spectral.implementation_hash():
    raise SystemExit('Processing code differs. Saved JSON/FITS still replay exactly; use the recorded implementation for numerical reproduction.')
spectral.CONFIG = saved['config']
frames = [Frame('retained spectral image', s['sourceUrl'], store.asset(args.evidence_id,s['sourceSha256']), s['observedAtUtc'], s['observedUntilUtc'], s['observationId'], s['release']) for s in saved['samples']]
new = spectral.analyze(SourceResult('spherex','ok',frames),manifest['ra'],manifest['dec'])
for a,b in zip(saved['samples'],new.samples):
    if a['status'] != b.status: raise SystemExit('Measurement status changed')
    for key in ['wavelengthUm','bandwidthUm','brightnessMjySr','uncertaintyMjySr','snr']:
        original, current = a[key], getattr(b,key)
        if original is not None and (current is None or not math.isclose(original,current,rel_tol=1e-7,abs_tol=1e-10)):
            raise SystemExit(f'Measurement differs: {key}')
if [(f['key'],f['status'],f['points']) for f in saved['features']] != [(f.key,f.status,f.points) for f in new.features]:
    raise SystemExit('Feature-screen result changed')
print(f'Verified {len(frames)} retained cutouts and measurements (rtol=1e-7, atol=1e-10). No archive requests.')
