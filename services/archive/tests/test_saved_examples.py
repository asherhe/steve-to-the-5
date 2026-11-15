"""Saved examples open by ID only; a field search always queries the archive."""
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from services.archive.api import create_app
from services.archive.models import ArchiveError, FieldRequest, ProcessingConfig
from services.archive.pipeline import Pipeline
from services.archive.storage import LocalStore

ROOT = Path(__file__).resolve().parents[3]
EXAMPLES = ('real', 'real-barnard', 'real-wise0855', 'real-epsindib', 'real-rdraconis')
BARNARD = '19c551e87f4b416c06c7052e0e2cc5cf62b5ec5539a3afc6b2e1eeb6e758afa9'


class OfflineArchive:
    """Records each search; IRSA is unreachable in this test."""
    evidence_kind = 'real_archive'
    discovery_scope = 'test'

    def __init__(self):
        self.searched = []

    def discover(self, field, *_args):
        self.searched.append(field)
        raise ArchiveError('UPSTREAM_UNAVAILABLE', 'Archive offline in this test', 503)


def saved_fields():
    store = LocalStore(ROOT / 'unused', [ROOT / 'fixtures/archive' / name / 'evidence' for name in EXAMPLES])
    for name in EXAMPLES:
        for manifest in (ROOT / 'fixtures/archive' / name / 'evidence/manifests').glob('*.json'):
            yield name, store.load_raw(manifest.stem)['comparison']['field']


@pytest.mark.parametrize('name,field', list(saved_fields()), ids=lambda value: value if isinstance(value, str) else '')
def test_search_at_a_saved_field_queries_the_archive_not_the_saved_example(tmp_path, name, field):
    store = LocalStore(tmp_path, [ROOT / 'fixtures/archive' / item / 'evidence' for item in EXAMPLES])
    archive = OfflineArchive()
    app = TestClient(create_app(Pipeline(archive, store, ProcessingConfig())))
    response = app.get('/api/comparisons', params=FieldRequest(**field).model_dump(by_alias=True))
    assert len(archive.searched) == 1
    assert 'X-SPHEREx-Evidence' not in response.headers
    assert response.json()['status'] == 'upstream_unavailable'
    assert response.json().get('comparison') is None


def test_saved_barnard_example_replays_by_id(tmp_path):
    """The viewer's saved example: Barnard's Star, two dated 4.29 um frames 393 days apart."""
    store = LocalStore(tmp_path, [ROOT / 'fixtures/archive/real-barnard/evidence'])
    archive = OfflineArchive()
    app = TestClient(create_app(Pipeline(archive, store, ProcessingConfig())))
    response = app.get(f'/api/comparisons/{BARNARD}')
    assert response.status_code == 200
    assert response.json() == store.load_raw(BARNARD)
    comparison = response.json()['comparison']
    assert [f['observedAtUtc'][:10] for f in comparison['frames']] == ['2025-08-25', '2026-09-22']
    assert {f['detector'] for f in comparison['frames']} == {5}
    for frame in comparison['frames']:
        assert app.get(frame['imageUrl']).headers['content-type'].startswith('image/png')
    assert archive.searched == []
