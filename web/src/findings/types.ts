// Contract types for the findings UI. Shapes match the Brief 4 backend
// (services/findings/models.py and fixtures/responses.json). Replace with
// re-exports of the coordinator's generated OpenAPI types once they exist.

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
export type FindingDetail = {
  id: string;
  comparisonId: string;
  ra: number;
  dec: number;
  title: string;
  note: string;
  marks: EvidenceMark[];
  authorDisplayName: string;
  createdAtUtc: string;
  replies: FindingReply[];
};

export type CreateFindingRequest = {
  comparisonId: string;
  ra: number;
  dec: number;
  title: string;
  note: string;
  marks?: EvidenceMark[];
};
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
};
