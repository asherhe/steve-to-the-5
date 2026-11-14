import { useEffect, useRef, useState } from 'react';
import type { FindingsClient } from './api.ts';
import { isUnauthorized, messageFor } from './api.ts';
import { clearDraft, loadFindingDraft, saveDraft } from './draft.ts';
import { formatSky } from './format.ts';
import type { EvidenceMark, FindingsSession, SkyPosition } from './types.ts';
import { LIMITS, charCount, hasErrors, validateFindingDraft } from './validation.ts';

export type ComposerProps = {
  client: FindingsClient;
  session: FindingsSession;
  comparisonId: string | null;
  frameIds: readonly string[];
  activeFrameId: string | null;
  selection: SkyPosition | null;
  marks: EvidenceMark[];
  onMarksChange(marks: EvidenceMark[]): void;
  /** Shell starts sign-in; drafts are already saved when this fires. */
  onRequestSignIn(): void;
  onCreated(findingId: string): void;
};

export function Composer(p: ComposerProps) {
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const restored = useRef<string | null>(null);

  // Restore a draft saved before sign-in redirect (once per comparison).
  useEffect(() => {
    if (!p.comparisonId || restored.current === p.comparisonId) return;
    restored.current = p.comparisonId;
    const d = loadFindingDraft(p.comparisonId);
    if (d) {
      setTitle(d.title);
      setNote(d.note);
      if (d.marks.length && !p.marks.length) p.onMarksChange(d.marks);
    }
  }, [p.comparisonId]); // eslint-disable-line react-hooks/exhaustive-deps

  const errors = validateFindingDraft({ comparisonId: p.comparisonId, selection: p.selection, title, note, marks: p.marks, frameIds: p.frameIds });

  function persist() {
    if (!p.comparisonId) return;
    saveDraft({ kind: 'finding', comparisonId: p.comparisonId, title, note, selection: p.selection, marks: p.marks });
  }

  function addMark() {
    if (!p.selection || !p.activeFrameId) return;
    p.onMarksChange([...p.marks.filter((m) => m.frameId !== p.activeFrameId), { frameId: p.activeFrameId, ra: p.selection.ra, dec: p.selection.dec }]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setShowErrors(true);
    setError(null);
    if (hasErrors(errors)) return;
    if (!p.session) {
      persist();
      return p.onRequestSignIn();
    }
    setBusy(true);
    try {
      const { id } = await p.client.createFinding({
        comparisonId: p.comparisonId!,
        ra: p.selection!.ra,
        dec: p.selection!.dec,
        title: title.trim(),
        note: note.trim(),
        marks: p.marks.length ? p.marks : undefined,
      });
      clearDraft({ kind: 'finding', comparisonId: p.comparisonId! });
      setTitle('');
      setNote('');
      setShowErrors(false);
      p.onMarksChange([]);
      p.onCreated(id);
    } catch (err) {
      persist(); // keep the text if the write failed or the session expired
      setError(isUnauthorized(err) ? 'Your session expired. Sign in again; your draft is kept.' : messageFor(err, 'Could not post. Your draft is kept; try again.'));
    } finally {
      setBusy(false);
    }
  }

  const fe = showErrors ? errors : {};
  return (
    <form className="findings-composer" onSubmit={submit} noValidate aria-label="Post a finding">
      <h3>Post a finding</h3>
      <p className="hint">A finding is an observation or a question for others to check, not a confirmed discovery.</p>
      <p data-testid="composer-position">{p.selection ? formatSky(p.selection) : 'No point selected.'}</p>
      {fe.position || fe.comparison ? <p role="alert">{fe.position ?? fe.comparison}</p> : null}
      <label>
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={LIMITS.titleMaxChars * 2} aria-invalid={!!fe.title} />
      </label>
      {fe.title ? <p role="alert">{fe.title}</p> : null}
      <label>
        Note
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} aria-invalid={!!fe.note} />
      </label>
      <small>
        {charCount(note)}/{LIMITS.noteMaxChars}
      </small>
      {fe.note ? <p role="alert">{fe.note}</p> : null}
      <div className="marks">
        <button type="button" onClick={addMark} disabled={!p.selection || !p.activeFrameId}>
          Mark this position on the current frame
        </button>
        {p.marks.length ? (
          <ul aria-label="Evidence marks">
            {p.marks.map((m) => (
              <li key={m.frameId}>
                {m.frameId}{' '}
                <button type="button" onClick={() => p.onMarksChange(p.marks.filter((x) => x.frameId !== m.frameId))} aria-label={`Remove mark on ${m.frameId}`}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {fe.marks ? <p role="alert">{fe.marks}</p> : null}
      </div>
      {error ? <p role="alert">{error}</p> : null}
      <button type="submit" disabled={busy}>
        {busy ? 'Posting…' : p.session ? 'Post finding' : 'Sign in to post'}
      </button>
    </form>
  );
}
