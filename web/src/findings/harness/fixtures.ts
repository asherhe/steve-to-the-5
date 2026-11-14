// SYNTHETIC FIXTURES. Not real SPHEREx observations, not backend output and not
// scientific findings. Coordinates sit near challenge targets only so the
// harness has a plausible sky layout. Replace with the findings owner's fixture
// responses once they exist.
import type { FindingDetail } from '../types.ts';

export const PIN_ZOOM = 8;

export const FIXTURE_COMPARISONS = [
  { id: 'cmp_fixture_barnard', label: "Synthetic comparison near Barnard's Star", frameIds: ['frm_fixture_barnard_a', 'frm_fixture_barnard_b'] },
  { id: 'cmp_fixture_rwaur', label: 'Synthetic comparison near RW Aurigae', frameIds: ['frm_fixture_rwaur_a', 'frm_fixture_rwaur_b', 'frm_fixture_rwaur_c'] },
] as const;

const ADA = { displayName: 'Ada (fixture)' };
const GRACE = { displayName: 'Grace (fixture)' };

export const FIXTURE_FINDINGS: FindingDetail[] = [
  {
    id: 'fnd_fixture_001',
    comparisonId: 'cmp_fixture_barnard',
    ra: 269.4521,
    dec: 4.6934,
    title: 'Bright source position differs between frames?',
    note: 'Synthetic fixture text. The bright source near the centre looks offset between the two frames. Could someone compare against the Gaia proper motion?',
    marks: [
      { frameId: 'frm_fixture_barnard_a', ra: 269.4521, dec: 4.6934 },
      { frameId: 'frm_fixture_barnard_b', ra: 269.4519, dec: 4.6941 },
    ],
    author: ADA,
    createdAt: '2026-11-14T15:02:00Z',
    replies: [
      { id: 'rpl_fixture_001', text: 'Synthetic fixture reply. The direction looks consistent with the catalogue proper motion.', author: GRACE, createdAt: '2026-11-14T15:20:00Z' },
    ],
  },
  {
    id: 'fnd_fixture_002',
    comparisonId: 'cmp_fixture_barnard',
    ra: 269.4602,
    dec: 4.7011,
    title: 'Faint smudge only in the second frame',
    note: 'Synthetic fixture text. Possibly an artifact; quality flags not yet checked.',
    marks: [{ frameId: 'frm_fixture_barnard_b', ra: 269.4602, dec: 4.7011 }],
    author: GRACE,
    createdAt: '2026-11-14T16:00:00Z',
    replies: [],
  },
  {
    id: 'fnd_fixture_003',
    comparisonId: 'cmp_fixture_barnard',
    ra: 269.4409,
    dec: 4.6858,
    title: '<b>Markup in a title stays plain text</b>',
    note: 'Synthetic fixture text with <script>alert(1)</script> to check plain-text rendering.',
    marks: [],
    author: ADA,
    createdAt: '2026-11-14T16:30:00Z',
    replies: [],
  },
  {
    id: 'fnd_fixture_004',
    comparisonId: 'cmp_fixture_rwaur',
    ra: 76.9563,
    dec: 30.4014,
    title: 'Brightness looks different across three dates',
    note: 'Synthetic fixture text. A question for discussion, not a measured variability claim.',
    marks: [{ frameId: 'frm_fixture_rwaur_c', ra: 76.9563, dec: 30.4014 }],
    author: GRACE,
    createdAt: '2026-11-14T17:00:00Z',
    replies: [],
  },
  {
    id: 'fnd_fixture_005',
    comparisonId: 'cmp_fixture_rwaur',
    ra: 76.9701,
    dec: 30.3952,
    title: 'Neighbouring star for reference',
    note: 'Synthetic fixture text.',
    marks: [],
    author: ADA,
    createdAt: '2026-11-14T17:10:00Z',
    replies: [],
  },
];
