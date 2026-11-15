"""Real API + all SQL migrations. Only Supabase auth/PostgREST and catalogs are simulated."""
import asyncio
import copy
import json
from pathlib import Path
import subprocess
import unittest

import httpx
from fastapi import FastAPI
from services.findings import create_router
from services.findings.supabase import Supabase
from test_database_flow import HAS_DATABASE, TEST_DIR
from test_findings import OWNER, READER

ROOT = Path(__file__).resolve().parents[3]
FIXTURE = json.loads((ROOT / 'services/findings/fixtures/candidate-flow.json').read_text())
SAVED = json.loads((ROOT / 'fixtures/archive/real/response.json').read_text())['comparison']
WISE = json.loads(next((ROOT / 'fixtures/wise/real-wise0855/evidence/manifests').glob('*.json')).read_text())['response']['comparison']


@unittest.skipUnless(HAS_DATABASE, 'PGlite is required')
class ReviewDatabaseFlow(unittest.IsolatedAsyncioTestCase):
    async def test_review_rank_anonymous_replay_second_account_reply_and_deduplication(self):
        db = subprocess.Popen(['node', str(TEST_DIR / 'pglite_bridge.cjs')], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8')
        lock = asyncio.Lock()
        def command(endpoint, payload, method='POST'):
            db.stdin.write(json.dumps({'endpoint': endpoint, 'payload': payload, 'method': method}) + '\n')
            db.stdin.flush()
            return json.loads(db.stdout.readline())
        try:
            self.assertEqual(json.loads(await asyncio.wait_for(asyncio.to_thread(db.stdout.readline), 15)), {'ready': True})
            async def upstream(request):
                if request.url.path == '/auth/v1/user':
                    token = request.headers.get('Authorization')
                    if token not in ('Bearer one', 'Bearer two'):
                        return httpx.Response(401)
                    return httpx.Response(200, json={'id': OWNER if token == 'Bearer one' else READER, 'user_metadata': {'display_name': 'Observer One' if token == 'Bearer one' else 'Observer Two'}})
                self.assertEqual(request.headers['apikey'], 'server-only')
                payload = dict(request.url.params) if request.method == 'GET' else json.loads(request.content)
                async with lock:
                    answer = await asyncio.wait_for(asyncio.to_thread(command, request.url.path.removeprefix('/rest/v1/'), payload, request.method), 10)
                if 'error' in answer:
                    return httpx.Response(409 if answer['error']['code'] == '23505' else 500, json=answer['error'])
                return httpx.Response(200, json=answer['result'])
            saved = copy.deepcopy(SAVED)
            async def load(identifier):
                return saved if identifier == saved['id'] else WISE if identifier == WISE['id'] else None
            point = {'ra': WISE['field']['ra'], 'dec': WISE['field']['dec']}
            async def catalogs(ra, dec, radius, observed):
                report = copy.deepcopy(FIXTURE['review']['catalogReview'])
                report.update(ra=ra, dec=dec, radiusArcsec=radius, observedAtUtc=observed)
                # A synthetic Gaia row at the first point: every nearby point is the same known object.
                report['checks'][0].update(status='candidates', rows=[{'sourceId': '42', **point}])
                return report
            async def cutouts(ra, dec):
                return []  # Explicitly unavailable spectral imagery; preserves base-only score.
            async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as proxy:
                app = FastAPI()
                app.include_router(create_router(Supabase(proxy, 'https://supabase.test', 'public', 'server-only'), load,
                                                 load_wise_comparison=load, load_catalog_review=catalogs, load_cutouts=cutouts))
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as api:
                    one, two = {'Authorization': 'Bearer one'}, {'Authorization': 'Bearer two'}
                    request = {**point, 'radiusArcsec': 30, 'wiseComparisonId': WISE['id']}
                    missing_blink = await api.post('/api/findings/points/review', json=point, headers=one)
                    self.assertEqual((missing_blink.status_code, missing_blink.json()['code']), (422, 'wise_blink_required'))
                    self.assertEqual((await api.post('/api/findings/points/review', json=request)).status_code, 401)
                    reviewed = await api.post('/api/findings/points/review', json=request, headers=one)
                    self.assertEqual(reviewed.status_code, 201, reviewed.text)
                    report = reviewed.json()
                    self.assertEqual((report['score'], report['classification'], report['identity']['name'], report['duplicate']),
                                     (10, 'known', '42', None))
                    body = {**point, 'title': 'Known star in SPHEREx', 'note': 'Is this the Gaia source?', 'reviewId': report['id']}
                    self.assertEqual((await api.post('/api/findings', json=body)).status_code, 401)
                    self.assertEqual((await api.post('/api/findings', json=body, headers=two)).status_code, 422)
                    created = await api.post('/api/findings', json=body, headers=one)
                    self.assertEqual(created.status_code, 201, created.text)
                    identifier = created.json()['id']
                    board = (await api.get('/api/findings/leaderboard?board=allTime')).json()
                    self.assertEqual([(e['rarityScore'], e['rank'], e['comparisonId']) for e in board['entries']], [(10, 1, None)])
                    # A second user 20 arcsec away (outside the 15 arcsec radius) matches the same Gaia source.
                    other = {'ra': point['ra'], 'dec': point['dec'] + 20 / 3600, 'radiusArcsec': 30, 'wiseComparisonId': WISE['id']}
                    second = (await api.post('/api/findings/points/review', json=other, headers=two)).json()
                    self.assertTrue(second['duplicate']['sameObject'])
                    second_body = {'ra': other['ra'], 'dec': other['dec'], 'title': 'Same star', 'note': 'Again', 'reviewId': second['id']}
                    blocked = await api.post('/api/findings', json=second_body, headers=two)
                    self.assertEqual((blocked.status_code, blocked.json()['code']), (409, 'already_on_leaderboard'))
                    thread = (await api.get('/api/findings/' + identifier)).json()
                    self.assertEqual((thread['comparisonId'], thread['marks'], thread['candidateReview']['score']), (None, [], 10))
                    self.assertNotIn('email', json.dumps(thread))
                    reply = await api.post(f'/api/findings/{identifier}/replies', json={'text': 'Matches Gaia.'}, headers=two)
                    self.assertEqual(reply.status_code, 201)
                    await asyncio.to_thread(command, 'hide', {'id': identifier})
                    self.assertEqual((await api.get('/api/findings/leaderboard?board=allTime')).json()['entries'], [])
                    # A hidden entry no longer holds the object.
                    retry = await api.post('/api/findings', json=second_body, headers=two)
                    self.assertEqual(retry.status_code, 201, retry.text)
                    self.assertEqual(saved, SAVED, 'Review/discussion must not mutate image evidence')
        finally:
            db.stdin.close()
            try:
                await asyncio.to_thread(db.wait, timeout=10)
            except subprocess.TimeoutExpired:
                db.kill(); db.wait(timeout=5)
            db.stdout.close(); db.stderr.close()
        self.assertEqual(db.returncode, 0)
