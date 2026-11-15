"""Exact reviewed fields replay immediately without an IRSA request."""
from pathlib import Path
from fastapi.testclient import TestClient
from services.archive.api import create_app
from services.archive.models import FieldRequest, ProcessingConfig
from services.archive.pipeline import Pipeline
from services.archive.storage import LocalStore

ROOT = Path(__file__).resolve().parents[3]

class NoNetwork:
    def discover(self, *_args):
        raise AssertionError('A recorded field must not contact IRSA')

def test_recorded_wise0855_field_uses_integrity_checked_saved_evidence(tmp_path):
    examples = [ROOT / 'fixtures/archive' / name / 'evidence'
                for name in ('real', 'real-wise0855', 'real-epsindib', 'real-rdraconis')]
    store = LocalStore(tmp_path, examples)
    field = FieldRequest(ra=133.79512916666664, dec=-7.245147222222222, fovArcmin=6)
    app = TestClient(create_app(Pipeline(NoNetwork(), store, ProcessingConfig())))
    response = app.get('/api/comparisons', params=field.model_dump(by_alias=True))
    assert response.status_code == 200
    assert response.headers['X-SPHEREx-Evidence'] == 'saved-real-example'
    assert response.json() == store.load_raw('c8b69cb6d887da6f5e7e3d18164de1e0e3a24f6eef9002f9d26b3b44085f9416')
    for frame in response.json()['comparison']['frames']:
        asset = app.get(frame['imageUrl'])
        assert asset.status_code == 200
        assert asset.headers['content-type'].startswith('image/png')
