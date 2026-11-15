import { useCallback, useEffect, useState } from 'react';
import type { FindingsClient } from './api.ts';
import { isAbortError, isUnauthorized, messageFor } from './api.ts';
import { copyText } from './clipboard.ts';
import { clearDraft, loadReplyDraft, saveDraft } from './draft.ts';
import { formatSky, formatUtc } from './format.ts';
import { buildReplayUrl } from './links.ts';
import type { EvidenceRequest, FindingDetail, FindingsSession } from './types.ts';
import { ReviewReport } from './ReviewReport';
import { LIMITS, charCount, validateReplyText } from './validation.ts';

export type FindingThreadProps = {
  client: FindingsClient;
  session: FindingsSession;
  findingId: string;
  onClose(): void;
  onShowEvidence(req: EvidenceRequest): void;
  onRequestSignIn(): void;
  /** Defaults to window.location.href. */
  currentHref?: string;
};

type Load = { status: 'loading' } | { status: 'error'; message: string; notFound: boolean } | { status: 'ready'; finding: FindingDetail };

export function FindingThread(p: FindingThreadProps) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ctl = new AbortController();
    setLoad({ status: 'loading' });
    setError(null);
    setCopied('idle');
    setText(loadReplyDraft(p.findingId)?.text ?? '');
    p.client
      .getFinding(p.findingId, ctl.signal)
      .then((finding) => { if (!ctl.signal.aborted) setLoad({ status: 'ready', finding }); })
      .catch((e) => {
        if (isAbortError(e) || ctl.signal.aborted) return;
        setLoad({ status: 'error', message: messageFor(e, 'Could not load this finding.'), notFound: (e as { status?: number }).status === 404 });
      });
    return () => ctl.abort();
  }, [p.client, p.findingId, attempt]);

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (busy) return;
      setError(null);
      const problem = validateReplyText(text);
      if (problem) return setError(problem);
      if (!p.session) {
        saveDraft({ kind: 'reply', findingId: p.findingId, text });
        return p.onRequestSignIn();
      }
      setBusy(true);
      try {
        const reply = await p.client.createReply(p.findingId, { text: text.trim() });
        clearDraft({ kind: 'reply', findingId: p.findingId });
        setText('');
        setLoad((l) => (l.status === 'ready' ? { status: 'ready', finding: { ...l.finding, replies: [...l.finding.replies, reply] } } : l));
      } catch (err) {
        saveDraft({ kind: 'reply', findingId: p.findingId, text });
        setError(isUnauthorized(err) ? 'Your session expired. Sign in again; your reply is kept.' : messageFor(err, 'Could not post your reply. It is kept; try again.'));
      } finally {
        setBusy(false);
      }
    },
    [busy, text, p],
  );

  if (load.status === 'loading') return <section aria-busy="true" role="status">Loading finding…</section>;
  if (load.status === 'error')
    return (
      <section>
        <p role="alert">{load.message}</p>
        {!load.notFound ? <button type="button" onClick={() => setAttempt((a) => a + 1)}>Retry</button> : null}
        <button type="button" onClick={p.onClose}>Close</button>
      </section>
    );

  const f = load.finding;
  const link = () => buildReplayUrl(p.currentHref ?? globalThis.location?.href ?? 'http://localhost/', { comparisonId: f.comparisonId, findingId: f.id, survey: f.survey ?? 'spherex' });
  return (
    <section className="findings-thread" aria-label="Finding discussion">
      <button type="button" onClick={p.onClose} aria-label="Close discussion">×</button>
      {/* Plain text only: React escapes everything below. */}
      <h3>{f.title}</h3>
      <p className="meta">
        {f.authorDisplayName} · {formatUtc(f.createdAtUtc)} · {formatSky(f)}
      </p>
      {f.note ? <p style={{ whiteSpace: 'pre-wrap' }}>{f.note}</p> : null}
      <p className="hint">An observation or question from a community member, not a validated discovery.</p>
      <p>{f.comparisonId ? `${f.marks.length} evidence mark${f.marks.length === 1 ? '' : 's'}` : 'Submitted sky position; no saved image comparison is attached.'}</p>
      <div className="actions">
        <button type="button" onClick={() => p.onShowEvidence({ findingId: f.id, comparisonId: f.comparisonId ?? null, position: { ra: f.ra, dec: f.dec }, marks: f.marks, survey: f.survey ?? 'spherex' })}>
          {f.comparisonId ? 'Show evidence' : 'Show point on map'}
        </button>
        <button type="button" onClick={async () => setCopied((await copyText(link())) ? 'ok' : 'failed')}>
          Copy link
        </button>
        <span role="status" aria-live="polite">
          {copied === 'ok' ? 'Link copied.' : ''}
        </span>
      </div>
      {copied === 'failed' ? (
        <label>
          Copy this link manually
          <input readOnly value={link()} onFocus={(e) => e.currentTarget.select()} />
        </label>
      ) : null}
      {f.candidateReview && <ReviewReport review={f.candidateReview} />}
      <h4>Replies ({f.replies.length})</h4>
      {f.replies.length === 0 ? <p>No replies yet.</p> : null}
      <ul>
        {f.replies.map((r) => (
          <li key={r.id}>
            <strong>{r.authorDisplayName}</strong> · {formatUtc(r.createdAtUtc)}
            <p style={{ whiteSpace: 'pre-wrap' }}>{r.text}</p>
          </li>
        ))}
      </ul>
      <form onSubmit={submit} noValidate aria-label="Reply to this finding">
        <label>
          Reply
          <textarea value={text} onChange={(e) => { setText(e.target.value); saveDraft({ kind: 'reply', findingId: p.findingId, text: e.target.value }); }} rows={3} />
        </label>
        <small>
          {charCount(text)}/{LIMITS.replyMaxChars}
        </small>
        {error ? <p role="alert">{error}</p> : null}
        {error?.includes('Sign in again') && <button type="button" onClick={p.onRequestSignIn}>Sign in again</button>}
        <button type="submit" disabled={busy}>
          {busy ? 'Posting…' : p.session ? 'Reply' : 'Sign in to reply'}
        </button>
      </form>
    </section>
  );
}
