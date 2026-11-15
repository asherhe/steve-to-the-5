import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js';
import { createFindingsClient, FindingsApiError } from './api';
import type { FindingsSession } from './types';

export type AuthSession = NonNullable<FindingsSession> & { userId: string };
export interface AuthGateway {
  initialize(): Promise<AuthSession | null>;
  subscribe(listener: (session: AuthSession | null) => void): () => void;
  headers(): Promise<Record<string, string>>;
  sendEmail(email: string, redirectTo: string): Promise<void>;
  verifyCode(email: string, code: string): Promise<void>;
  signOut(): Promise<void>;
}
const publicSession = (session: Session | null): AuthSession | null => session ? {
  userId: session.user.id,
  displayName: typeof session.user.user_metadata?.display_name === 'string'
    ? session.user.user_metadata.display_name.slice(0, 80) : 'Sky observer',
} : null;

/** Browser receives only the publishable key. All database writes go through FastAPI. */
export function createAuthGateway(): AuthGateway {
  let client: SupabaseClient | null = null;
  let pending: Promise<SupabaseClient> | null = null;
  const listeners = new Set<(session: AuthSession | null) => void>();
  async function connect() {
    if (client) return client;
    if (!pending) pending = createFindingsClient().authConfig().then(config => {
      client = createClient(config.url, config.publishableKey, {
        auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
      });
      client.auth.onAuthStateChange((_event, session) => {
        // No asynchronous Supabase calls inside this callback (the auth lock is held).
        for (const listener of listeners) listener(publicSession(session));
      });
      return client;
    }).catch(error => { pending = null; throw error; });
    return pending;
  }
  return {
    async initialize() {
      const { data, error } = await (await connect()).auth.getSession();
      if (error) throw error;
      return publicSession(data.session);
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async headers() {
      const { data, error } = await (await connect()).auth.getSession();
      if (error || !data.session) throw new FindingsApiError(401, 'unauthorized', 'Sign in again. Your draft is kept.');
      return { Authorization: `Bearer ${data.session.access_token}` };
    },
    async sendEmail(email, redirectTo) {
      const { error } = await (await connect()).auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
      if (error) throw error;
    },
    async verifyCode(email, token) {
      const { error } = await (await connect()).auth.verifyOtp({ email, token, type: 'email' });
      if (error) throw error;
    },
    async signOut() {
      const { error } = await (await connect()).auth.signOut({ scope: 'local' });
      if (error) throw error;
    },
  };
}

export function authReturnUrl(href: string): string {
  const current = new URL(href);
  const clean = new URL(current.origin + current.pathname);
  for (const key of ['view', 'comparison', 'finding', 'reviewFrame', 'reviewRa', 'reviewDec']) {
    const value = current.searchParams.get(key);
    if (value) clean.searchParams.set(key, value);
  }
  return clean.href;
}
