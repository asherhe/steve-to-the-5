import type { components } from './findings.generated';
import type { components as CatalogComponents } from '../inspector/catalog.generated';

type Schema = components['schemas'];
export type Survey = 'spherex' | 'wise';
export type ReviewInput = Schema['ReviewInput'];
export type CatalogReview = CatalogComponents['schemas']['CatalogReview'];
export type CatalogCheck = CatalogComponents['schemas']['CatalogCheck'];
export type CandidateReview = Omit<Schema['ReviewResponse'], 'catalogReview'> & { catalogReview: CatalogReview };
export type PublicAuthConfig = Schema['PublicAuthConfig'];

/** ICRS decimal degrees. */
export type SkyPosition = { ra: number; dec: number };

export type ApiErrorBody = { code: string; message: string };

export type FindingPin = { id: string; ra: number; dec: number; title: string };
/** zoomTo: integer map zoom at which this cluster resolves into pins. */
export type FindingCluster = { ra: number; dec: number; count: number; zoomTo: number };
export type FindingListItem = FindingPin | FindingCluster;
export type FindingListResponse = { items: FindingListItem[] };

/** Query for GET /api/findings?ra&dec&radiusDeg&zoom (zoom is sent as an integer 0–30). */
export type FindingsViewport = { ra: number; dec: number; radiusDeg: number; zoom: number };

export type EvidenceMark = { frameId: string; ra: number; dec: number };

export type FindingReply = { id: string; text: string; authorDisplayName: string; createdAtUtc: string };
// Optional defaulted fields keep historical, unreviewed findings readable.
export type FindingDetail = Omit<Schema['Finding'], 'survey' | 'candidateReview'> & {
  survey?: Survey;
  candidateReview?: CandidateReview | null;
};
export type CreateFindingRequest = Omit<Schema['FindingInput'], 'survey' | 'marks'> & { survey?: Survey; marks?: EvidenceMark[] };
export type CreateFindingResponse = { id: string };
export type CreateReplyRequest = { text: string };

/** Supplied by the app shell. The findings UI never talks to Supabase directly. */
export type FindingsSession = { displayName: string } | null;

/** Emitted by "Show evidence"; the viewer restores frames and annotations. */
export type EvidenceRequest = {
  findingId: string;
  comparisonId: string;
  position: SkyPosition;
  marks: EvidenceMark[];
  survey?: Survey;
};
