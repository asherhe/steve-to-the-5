import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { FloatingPane } from '../viewer/FloatingPane';
import { authReturnUrl, type AuthGateway, type AuthSession } from './auth';

type Account = { session: AuthSession | null; requestSignIn(): void; showAccount(): void; reauth: boolean; gateway: AuthGateway; loading: boolean; error: string; retry(): void; open: boolean; close(): void };
const Context = createContext<Account | null>(null);
export function useAccount() {
  const value = useContext(Context);
  if (!value) throw new Error('AccountProvider is required.');
  return value;
}
export function AccountProvider({ gateway, children }: { gateway: AuthGateway; children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState(false);
  const [reauth, setReauth] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    const unsubscribe = gateway.subscribe(next => { if (active) { setSession(next); if (next) { setOpen(false); setReauth(false); } } });
    gateway.initialize().then(next => { if (active) setSession(next); }).catch(() => {
      if (active) setError('Sign-in is unavailable. The findings service needs a configured Supabase instance. You can still explore and replay saved images.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; unsubscribe(); };
  }, [gateway, attempt]);
  return <Context.Provider value={{ session, gateway, loading, error, open, reauth, showAccount: () => { setReauth(false); setOpen(true); }, requestSignIn: () => { setReauth(true); setOpen(true); }, close: () => setOpen(false), retry: () => setAttempt(n => n + 1) }}>{children}</Context.Provider>;
}
export function AccountControls({ mode }: { mode: 'button' | 'pane' }) {
  const account = useAccount();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (mode === 'button') return <button type="button" onClick={account.showAccount} aria-expanded={account.open} aria-controls="account-panel">{account.session ? 'Account' : 'Sign in'}</button>;
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Sign-in failed. Please try again.'); } finally { setBusy(false); }
  }
  return <FloatingPane id="account-panel" title="Account" open={account.open} onClose={account.close}>
    {account.loading ? <p role="status">Connecting sign-in…</p> : account.error ? <><p role="alert">{account.error}</p><button onClick={account.retry}>Retry connection</button></> : account.session && !account.reauth ? <>
      <p>Signed in as {account.session.displayName}. Your email is not shown publicly.</p>
      <button disabled={busy} onClick={() => void run(() => account.gateway.signOut())}>Sign out</button>
    </> : <>
      <p>Sign in to review candidates, post findings and reply. Reading and evidence replay are public. Your draft stays in this tab.</p>
      <form onSubmit={e => { e.preventDefault(); void run(async () => { await account.gateway.sendEmail(email.trim(), authReturnUrl(location.href)); setSent(true); }); }}>
        <label>Email<input type="email" autoComplete="email" value={email} required onChange={e => { setEmail(e.target.value); setSent(false); }} /></label>
        <button disabled={busy || account.loading} type="submit">{busy ? 'Please wait…' : sent ? 'Resend sign-in email' : 'Send sign-in email'}</button>
      </form>
      {sent && <>
        <p role="status">Check your email. Open the sign-in link in this browser, or enter the code if your email includes one.</p>
        <form onSubmit={e => { e.preventDefault(); void run(() => account.gateway.verifyCode(email.trim(), code.trim())); }}>
          <label>Email code<input inputMode="numeric" autoComplete="one-time-code" value={code} required onChange={e => setCode(e.target.value)} /></label>
          <button disabled={busy} type="submit">Verify code</button>
        </form>
      </>}
    </>}
    {error && <p role="alert">{error}</p>}
  </FloatingPane>;
}
