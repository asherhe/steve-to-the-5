import type {
  ApiErrorBody,
  CreateFindingRequest,
  CreateFindingResponse,
  CreateReplyRequest,
  FindingDetail,
  FindingListResponse,
  FindingReply,
  FindingsViewport,
} from './types.ts';
import { clampViewport } from './validation.ts';

export class FindingsApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'FindingsApiError';
    this.status = status;
    this.code = code;
  }
}

export function isUnauthorized(err: unknown): boolean {
  return err instanceof FindingsApiError && (err.status === 401 || err.code === 'unauthorized');
}

export function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError';
}

/** User-facing message for any thrown value. */
export function messageFor(err: unknown, fallback: string): string {
  return err instanceof FindingsApiError && err.message ? err.message : fallback;
}

export interface FindingsClient {
  listFindings(viewport: FindingsViewport, signal?: AbortSignal): Promise<FindingListResponse>;
  getFinding(id: string, signal?: AbortSignal): Promise<FindingDetail>;
  createFinding(req: CreateFindingRequest): Promise<CreateFindingResponse>;
  createReply(findingId: string, req: CreateReplyRequest): Promise<FindingReply>;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type FindingsClientOptions = {
  /** Same-origin by default (''), e.g. '' -> '/api/findings'. */
  baseUrl?: string;
  fetch?: FetchLike;
  /** Supplied by the app shell (e.g. a bearer token). Only sent on writes. */
  getAuthHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
};

function fmt(n: number): string {
  return String(Number(n.toFixed(6)));
}

export function buildListQuery(v: FindingsViewport): string {
  const c = clampViewport(v);
  if (!c) throw new FindingsApiError(0, 'invalid_viewport', 'The map position is not a valid sky coordinate.');
  return new URLSearchParams({ ra: fmt(c.ra), dec: fmt(c.dec), radiusDeg: fmt(c.radiusDeg), zoom: fmt(c.zoom) }).toString();
}

function isErrorBody(b: unknown): b is ApiErrorBody {
  return !!b && typeof b === 'object' && typeof (b as ApiErrorBody).code === 'string' && typeof (b as ApiErrorBody).message === 'string';
}

function defaultMessage(status: number): string {
  if (status === 401) return 'Sign in to post.';
  if (status === 403) return 'You are not allowed to do that.';
  if (status === 404) return 'Not found.';
  if (status === 429) return 'Too many requests. Wait a moment and try again.';
  if (status >= 500) return 'The findings service is unavailable right now.';
  return `Request failed (${status}).`;
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function invalid(what: string): FindingsApiError {
  return new FindingsApiError(0, 'invalid_response', `The findings service returned an unexpected ${what}.`);
}

function asObject(b: unknown, what: string): Record<string, unknown> {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw invalid(what);
  return b as Record<string, unknown>;
}

export function createFindingsClient(opts: FindingsClientOptions = {}): FindingsClient {
  const base = (opts.baseUrl ?? '').replace(/\/+$/, '');
  const doFetch: FetchLike = opts.fetch ?? ((url, init) => globalThis.fetch(url, init));

  async function request(path: string, init: RequestInit, withAuth: boolean): Promise<unknown> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    if (withAuth && opts.getAuthHeaders) Object.assign(headers, await opts.getAuthHeaders());
    let res: Response;
    try {
      res = await doFetch(base + path, { ...init, headers, credentials: 'same-origin' });
    } catch (err) {
      if (isAbortError(err)) throw err;
      throw new FindingsApiError(0, 'network_error', 'Could not reach the findings service.');
    }
    const body = await readJson(res);
    if (!res.ok) {
      const e = isErrorBody(body) ? body : null;
      throw new FindingsApiError(res.status, e?.code ?? `http_${res.status}`, e?.message ?? defaultMessage(res.status));
    }
    return body;
  }

  return {
    async listFindings(viewport, signal) {
      const body = asObject(await request(`/api/findings?${buildListQuery(viewport)}`, { signal }, false), 'findings list');
      if (!Array.isArray(body.items)) throw invalid('findings list');
      return { items: body.items as FindingListResponse['items'] };
    },
    async getFinding(id, signal) {
      let raw: unknown;
      try {
        raw = await request(`/api/findings/${encodeURIComponent(id)}`, { signal }, false);
      } catch (err) {
        // The backend rejects malformed (non-UUID) IDs with 422; for a reader that is simply "not found".
        if (err instanceof FindingsApiError && err.status === 422) throw new FindingsApiError(404, 'finding_not_found', 'Finding not found.');
        throw err;
      }
      const body = asObject(raw, 'finding');
      if (typeof body.id !== 'string' || typeof body.comparisonId !== 'string' || typeof body.authorDisplayName !== 'string') throw invalid('finding');
      return {
        ...(body as unknown as FindingDetail),
        marks: Array.isArray(body.marks) ? (body.marks as FindingDetail['marks']) : [],
        replies: Array.isArray(body.replies) ? (body.replies as FindingDetail['replies']) : [],
      };
    },
    async createFinding(req) {
      const body = asObject(await request('/api/findings', { method: 'POST', body: JSON.stringify(req) }, true), 'response');
      if (typeof body.id !== 'string') throw invalid('response');
      return { id: body.id };
    },
    async createReply(findingId, req) {
      const body = asObject(
        await request(`/api/findings/${encodeURIComponent(findingId)}/replies`, { method: 'POST', body: JSON.stringify(req) }, true),
        'reply',
      );
      if (typeof body.id !== 'string' || typeof body.text !== 'string' || typeof body.authorDisplayName !== 'string') throw invalid('reply');
      return body as unknown as FindingReply;
    },
  };
}
