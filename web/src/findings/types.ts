// PROVISIONAL contract types for the findings UI.
// Mirrors the shared interface in spherex-agent-handoffs.md. Fields marked
// ASSUMED are not specified there and must be confirmed by the coordinator.
// Replace with re-exports of the coordinator's generated OpenAPI types.

/** ICRS decimal degrees. */
export type SkyPosition = { ra: number; dec: number };

export type ApiErrorBody = { code: string; message: string };

export type FindingPin = { id: string; ra: number; dec: number; title: string };
/** ASSUMED: zoomTo is the map zoom level at which this cluster resolves into pins. */
export type FindingCluster = { ra: number; dec: number; count: number; zoomTo: number };
export type FindingListItem = FindingPin | FindingCluster;
export type FindingListResponse = { items: FindingListItem[] };

/** Query for GET /api/findings?ra&dec&radiusDeg&zoom */
export type FindingsViewport = { ra: number; dec: number; radiusDeg: number; zoom: number };

export type EvidenceMark = { frameId: string; ra: number; dec: number };

// ASSUMED shapes: GET /api/findings/{id} and reply bodies are only described in prose.
export type Author = { displayName: string };
export type FindingReply = { id: string; text: string; author: Author; createdAt: string };
export type FindingDetail = {
  id: string;
  comparisonId: string;
  ra: number;
  dec: number;
  title: string;
  note: string;
  marks: EvidenceMark[];
  author: Author;
  createdAt: string;
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
