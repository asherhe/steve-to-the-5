"""Bounded live archive probe for the five challenge targets; no auth or public writes."""
import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import httpx
from services.findings import cutouts, spectral
from services.findings.spectral_store import SpectralStore

# Probe a smaller subset than the application's 48-image maximum. This verifies
# live FITS interpretation and explicit coverage states, not a complete spectrum.
cutouts.MAX_SPECTRAL_FRAMES = 12
TARGETS = [(p['name'],p['ra'],p['dec']) for p in json.loads((ROOT/'fixtures/catalogs/resolved-targets.json').read_text(encoding='utf-8'))]


async def main():
    slots = asyncio.Semaphore(2)
    store = SpectralStore(ROOT / '.local-test-temp/live-spectral')
    async with httpx.AsyncClient() as client:
        async def one(name,ra,dec):
            async with slots:
                try:
                    source = await asyncio.wait_for(cutouts.spherex(client,ra,dec),125)
                    result = await asyncio.to_thread(spectral.analyze,source,ra,dec)
                    if result.samples:
                        await asyncio.to_thread(store.save,result,source.frames,ra,dec)
                    row = {'target':name,'ra':ra,'dec':dec,'archiveStatus':source.status,'message':source.message,
                           'spectralStatus':result.status,'sampleCount':len(result.samples),'usableCount':sum(s.status=='measured' for s in result.samples),
                           'rejections':sorted(set(s.reason for s in result.samples if s.reason)),
                           'wavelengthsUm':[s.wavelengthUm for s in result.samples if s.status=='measured'],
                           'features':[{ 'key':f.key,'status':f.status } for f in result.features], 'evidenceId':result.evidenceId}
                except Exception as error:
                    row = {'target':name,'ra':ra,'dec':dec,'archiveStatus':'unavailable','error':f'{type(error).__name__}: {error}'}
                print(json.dumps(row,ensure_ascii=True),flush=True)
                return row
        rows = await asyncio.gather(*(one(*target) for target in TARGETS))
    output = {'checkedAtUtc':datetime.now(timezone.utc).isoformat(),'kind':'live_archive_probe','maxFramesPerTarget':12,
              'limitations':'Bounded source-format/coverage check; not a complete spectrum, chemical validation, hosted auth or deployed test.', 'targets':rows}
    (ROOT/'docs/verification/spectral-points-live.json').write_text(json.dumps(output,indent=2,ensure_ascii=True)+'\n',encoding='utf-8')


asyncio.run(main())
