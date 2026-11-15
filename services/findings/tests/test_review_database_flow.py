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
                return saved if identifier == saved['id'] else None
            async def catalogs(ra, dec, radius, observed):
                report = copy.deepcopy(FIXTURE['review']['catalogReview'])
                report.update(ra=ra, dec=dec, radiusArcsec=radius, observedAtUtc=observed)
                # Unavailability stays explicit in the saved snapshot and earns no catalog points.
                report['checks'][0]['status'] = 'unavailable'
                return report
            async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as proxy:
                app = FastAPI()
                app.include_router(create_router(Supabase(proxy, 'https://supabase.test', 'public', 'server-only'), load, load_wise_comparison=load, load_catalog_review=catalogs))
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as api:
                    headers = {'Authorization': 'Bearer one'}
                    request = {**FIXTURE['request'], 'survey': 'wise'}
                    self.assertEqual((await api.post('/api/findings/reviews', json=request)).status_code, 401)
                    reviewed = await api.post('/api/findings/reviews', json=request, headers=headers)
                    self.assertEqual(reviewed.status_code, 201, reviewed.text)
                    report = reviewed.json()
                    self.assertEqual(report['score'], 45)
                    body = {key: request[key] for key in ('ra', 'dec', 'comparisonId', 'survey')}
                    body.update(title='Review the dated point', note='Could this be an artifact?', reviewId=report['id'], marks=[{key: request[key] for key in ('frameId', 'ra', 'dec')}])
                    self.assertEqual((await api.post('/api/findings', json=body)).status_code, 401)
                    self.assertEqual((await api.post('/api/findings', json=body, headers={'Authorization': 'Bearer two'})).json()['code'], 'invalid_review')
                    created = await api.post('/api/findings', json=body, headers=headers)
                    self.assertEqual(created.status_code, 201, created.text)
                    identifier = created.json()['id']
                    duplicate = await api.post('/api/findings', json=body, headers=headers)
                    self.assertEqual(duplicate.status_code, 409)
                    board = (await api.get('/api/findings/leaderboard?board=allTime')).json()
                    self.assertEqual(len(board['entries']), 1)
                    self.assertEqual(board['entries'][0]['rarityScore'], 45)
                    self.assertEqual(board['entries'][0]['survey'], 'wise')
                    self.assertEqual(board['entries'][0]['rank'], 1)
                    thread = (await api.get('/api/findings/' + identifier)).json()
                    self.assertEqual(thread['candidateReview'], report)
                    self.assertEqual(thread['marks'], body['marks'])
                    self.assertEqual(thread['comparisonId'], SAVED['id'])
                    self.assertNotIn('email', json.dumps(thread))
                    self.assertEqual((await api.post(f'/api/findings/{identifier}/replies', json={'text': 'Anonymous'})).status_code, 401)
                    reply = await api.post(f'/api/findings/{identifier}/replies', json={'text': 'The saved dates agree.'}, headers={'Authorization': 'Bearer two'})
                    self.assertEqual(reply.status_code, 201)
                    thread = (await api.get('/api/findings/' + identifier)).json()
                    self.assertEqual(thread['replies'][0]['authorDisplayName'], 'Observer Two')
                    self.assertEqual(saved, SAVED, 'Review/discussion must not mutate image evidence')
                    await asyncio.to_thread(command, 'hide', {'id': identifier})
                    self.assertEqual((await api.get('/api/findings/' + identifier)).status_code, 404)
                    self.assertEqual((await api.get('/api/findings/leaderboard?board=allTime')).json()['entries'], [])
        finally:
            db.stdin.close()
            try:
                await asyncio.to_thread(db.wait, timeout=10)
            except subprocess.TimeoutExpired:
                db.kill(); db.wait(timeout=5)
            db.stdout.close(); db.stderr.close()
        self.assertEqual(db.returncode, 0)
