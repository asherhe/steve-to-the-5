// In-memory FindingsClient backed by synthetic fixtures. Mirrors the contract's
// status codes and {code, message} errors so UI states can be exercised before
// the findings backend exists. Not a model of the real clustering algorithm.
import type { FindingsClient } from '../api.ts';
import { FindingsApiError } from '../api.ts';
import type { FindingDetail, FindingListItem, FindingsSession, FindingsViewport } from '../types.ts';
import { LIMITS, charCount, clampViewport, isValidSkyPosition, validateReplyText } from '../validation.ts';
import { FIXTURE_COMPARISONS, FIXTURE_FINDINGS, PIN_ZOOM } from './fixtures.ts';

export type FixtureScenario = 'normal' | 'empty' | 'list_unavailable' | 'write_fails' | 'session_expired';
export const FIXTURE_SCENARIOS: FixtureScenario[] = ['normal', 'empty', 'list_unavailable', 'write_fails', 'session_expired'];

export type FixtureClientOptions = {
  scenario?: () => FixtureScenario;
  session?: () => FindingsSession;
  latencyMs?: number;
  now?: () => Date;
};

const DEG = Math.PI / 180;
function separationDeg(a: { ra: number; dec: number }, b: { ra: number; dec: number }): number {
  const s =
    Math.sin(((b.dec - a.dec) * DEG) / 2) ** 2 + Math.cos(a.dec * DEG) * Math.cos(b.dec * DEG) * Math.sin(((b.ra - a.ra) * DEG) / 2) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(s)))) / DEG;
}

function abortError(): Error {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}

export function createFixtureClient(opts: FixtureClientOptions = {}): FindingsClient & { reset(): void } {
  const scenario = opts.scenario ?? (() => 'normal' as FixtureScenario);
  const session = opts.session ?? (() => null);
  const latency = opts.latencyMs ?? 0;
  const now = opts.now ?? (() => new Date());
  let findings = new Map<string, FindingDetail>();
  let seq = 0;
  const reset = () => {
    findings = new Map(FIXTURE_FINDINGS.map((f) => [f.id, structuredClone(f)]));
    seq = 0;
  };
  reset();

  function respond<T>(fn: () => T, signal?: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(abortError());
      const run = () => {
        try {
          resolve(fn());
        } catch (e) {
          reject(e);
        }
      };
      if (latency <= 0) return void queueMicrotask(run);
      const t = setTimeout(run, latency);
      signal?.addEventListener('abort', () => {
        clearTimeout(t);
        reject(abortError());
      }, { once: true });
    });
  }

  function requireWriter(): NonNullable<FindingsSession> {
    const s = session();
    if (!s || scenario() === 'session_expired') throw new FindingsApiError(401, 'unauthorized', 'Sign in to post or reply.');
    if (scenario() === 'write_fails') throw new FindingsApiError(503, 'unavailable', 'The findings service is temporarily unavailable.');
    return s;
  }

  function list(v: FindingsViewport): FindingListItem[] {
    const c = clampViewport(v);
    if (!c) throw new FindingsApiError(400, 'invalid_request', 'Invalid viewport.');
    const inView = [...findings.values()].filter((f) => separationDeg(f, c) <= c.radiusDeg);
    const pin = (f: FindingDetail): FindingListItem => ({ id: f.id, ra: f.ra, dec: f.dec, title: f.title });
    if (c.zoom >= PIN_ZOOM) return inView.slice(0, LIMITS.maxMarkers).map(pin);
    const cell = 2 ** (PIN_ZOOM - c.zoom);
    const groups = new Map<string, FindingDetail[]>();
    for (const f of inView) {
      const k = `${Math.floor(f.ra / cell)}:${Math.floor(f.dec / cell)}`;
      groups.set(k, [...(groups.get(k) ?? []), f]);
    }
    return [...groups.values()].slice(0, LIMITS.maxMarkers).map((g) =>
      g.length === 1
        ? pin(g[0])
        : { ra: g.reduce((s, f) => s + f.ra, 0) / g.length, dec: g.reduce((s, f) => s + f.dec, 0) / g.length, count: g.length, zoomTo: PIN_ZOOM },
    );
  }

  return {
    reset,
    listFindings(v, signal) {
      return respond(() => {
        if (scenario() === 'list_unavailable') throw new FindingsApiError(503, 'unavailable', 'The findings service is temporarily unavailable.');
        return { items: scenario() === 'empty' ? [] : list(v) };
      }, signal);
    },
    getFinding(id, signal) {
      return respond(() => {
        const f = findings.get(id);
        if (!f) throw new FindingsApiError(404, 'finding_not_found', 'Finding not found.');
        return structuredClone(f);
      }, signal);
    },
    createFinding(req) {
      return respond(() => {
        const s = requireWriter();
        const cmp = FIXTURE_COMPARISONS.find((c) => c.id === req.comparisonId);
        if (!cmp) throw new FindingsApiError(422, 'invalid_comparison', 'Choose a saved comparison before posting.');
        if (!isValidSkyPosition(req)) throw new FindingsApiError(400, 'invalid_position', 'Invalid sky position.');
        const title = req.title.trim();
        if (!title || charCount(title) > LIMITS.titleMaxChars) throw new FindingsApiError(400, 'invalid_title', 'Invalid title.');
        const note = req.note.trim();
        if (!note || charCount(note) > LIMITS.noteMaxChars) throw new FindingsApiError(422, 'invalid_request', 'note: invalid length');
        const marks = req.marks ?? [];
        if (marks.some((m) => !(cmp.frameIds as readonly string[]).includes(m.frameId) || !isValidSkyPosition(m)))
          throw new FindingsApiError(422, 'invalid_frame', 'Each mark must belong to the saved comparison.');
        const id = `fnd_fixture_new_${++seq}`;
        findings.set(id, {
          id,
          comparisonId: cmp.id,
          ra: req.ra,
          dec: req.dec,
          title,
          note,
          marks: structuredClone(marks),
          authorDisplayName: s.displayName,
          createdAtUtc: now().toISOString(),
          replies: [],
        });
        return { id };
      });
    },
    createReply(findingId, req) {
      return respond(() => {
        const s = requireWriter();
        const f = findings.get(findingId);
        if (!f) throw new FindingsApiError(404, 'not_found', 'Finding not found.');
        const problem = validateReplyText(req.text);
        if (problem) throw new FindingsApiError(400, 'invalid_text', problem);
        const reply = { id: `rpl_fixture_new_${++seq}`, text: req.text.trim(), authorDisplayName: s.displayName, createdAtUtc: now().toISOString() };
        f.replies.push(reply);
        return structuredClone(reply);
      });
    },
  };
}
