from typing import Annotated, Literal
from uuid import UUID

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints


def database_text(value: str) -> str:
    # PostgreSQL UTF-8 text/jsonb cannot store NUL or unpaired UTF-16 surrogates.
    if "\x00" in value or any(0xD800 <= ord(char) <= 0xDFFF for char in value):
        raise ValueError("Text contains an unsupported character.")
    return value

RA = Annotated[float, Field(ge=0, lt=360, allow_inf_nan=False, strict=True)]
DEC = Annotated[float, Field(ge=-90, le=90, allow_inf_nan=False, strict=True)]
EvidenceId = Annotated[str, StringConstraints(min_length=1, max_length=256), AfterValidator(database_text)]
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120), AfterValidator(database_text)]
DiscussionText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000), AfterValidator(database_text)
]


class ErrorResponse(BaseModel):
    code: str
    message: str


class PublicAuthConfig(BaseModel):
    url: str
    publishableKey: str


class Coordinates(BaseModel):
    ra: RA
    dec: DEC


class Mark(Coordinates):
    model_config = ConfigDict(extra="forbid")
    frameId: EvidenceId


class FindingInput(Coordinates):
    model_config = ConfigDict(extra="forbid")
    # Omitted for a leaderboard point submitted from a point review (no saved comparison).
    comparisonId: EvidenceId | None = None
    survey: Literal["spherex", "wise"] = "spherex"
    reviewId: UUID | None = None
    title: Title
    note: DiscussionText
    marks: Annotated[list[Mark], Field(max_length=20)] = Field(default_factory=list)


class ReplyInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: DiscussionText


class CreatedFinding(BaseModel):
    id: UUID


class FindingBase(Coordinates):
    id: UUID
    title: str


class Pin(FindingBase):
    """A finding on the map. The summary fields are absent before the
    viewport-summary migration is applied, so clients treat them as optional."""
    authorDisplayName: str | None = None
    createdAtUtc: str | None = None
    replyCount: int | None = None
    survey: Literal["spherex", "wise"] | None = None


class Cluster(Coordinates):
    count: int
    zoomTo: int


class Viewport(BaseModel):
    items: list[Pin | Cluster]


class Reply(BaseModel):
    id: UUID
    authorDisplayName: str
    text: str
    createdAtUtc: str


class Finding(FindingBase):
    comparisonId: EvidenceId | None = None
    note: str
    marks: list[Mark]
    authorDisplayName: str
    createdAtUtc: str
    replies: list[Reply]
    survey: Literal["spherex", "wise"] = "spherex"
    candidateReview: dict | None = None


class EvidenceRef(BaseModel):
    """A saved comparison from another survey, used to test brightness at the point."""
    model_config = ConfigDict(extra="forbid")
    survey: Literal["spherex", "wise"]
    comparisonId: EvidenceId


class ReviewInput(Coordinates):
    model_config = ConfigDict(extra="forbid")
    comparisonId: EvidenceId
    frameId: EvidenceId
    survey: Literal["spherex", "wise"] = "spherex"
    radiusArcsec: float = Field(default=120, ge=5, le=300, allow_inf_nan=False)
    # Saved comparisons from the other surveys covering the point (one per survey).
    brightnessEvidence: Annotated[list[EvidenceRef], Field(max_length=2)] = Field(default_factory=list)


class BrightnessMeasurement(BaseModel):
    survey: Literal["spherex", "wise"]
    comparisonId: str
    frameId: str
    observedAtUtc: str | None = None
    status: Literal["measured", "outside", "unmeasurable", "unavailable"]
    snr: float | None = None
    bright: bool = False


class ReviewResponse(ReviewInput):
    id: UUID
    observedAtUtc: str
    reviewedAtUtc: str
    scoreVersion: str
    score: int
    classification: Literal["known", "uncatalogued", "incomplete"] | None = None
    reasons: list[str]
    catalogReview: dict
    brightness: list[BrightnessMeasurement] = Field(default_factory=list)
    limitations: list[str]


class LeaderboardEntry(Coordinates):
    id: UUID
    findingId: UUID
    comparisonId: str | None = None
    survey: Literal["spherex", "wise"]
    rank: int
    displayName: str
    title: str
    rarityScore: int
    tier: None = None
    reasons: list[str]
    fovArcmin: float | None = None
    enteredAtUtc: str


class LeaderboardResult(BaseModel):
    board: Literal["daily", "allTime"]
    placeholder: bool = False
    entries: list[LeaderboardEntry]


class FrameRef(BaseModel):
    """The dated frame a point was marked on; its observation time is used for SkyBoT."""
    model_config = ConfigDict(extra="forbid")
    survey: Literal["spherex", "wise"]
    comparisonId: EvidenceId
    frameId: EvidenceId


class PointReviewInput(Coordinates):
    model_config = ConfigDict(extra="forbid")
    radiusArcsec: float = Field(default=30, ge=5, le=300, allow_inf_nan=False)
    frame: FrameRef | None = None


class SourceMeasurement(BaseModel):
    survey: Literal["spherex", "wise", "dss", "neossat"]
    label: str | None = None
    sourceUrl: str | None = None
    observedAtUtc: str | None = None
    status: Literal["measured", "outside", "unmeasurable", "no_coverage", "unavailable"]
    snr: float | None = None
    bright: bool = False
    message: str | None = None


class CatalogIdentity(Coordinates):
    catalog: str
    name: str
    separationArcsec: float | None = None


class ExistingEntry(BaseModel):
    findingId: UUID
    title: str
    displayName: str
    separationArcsec: float | None = None
    sameObject: bool = False


class PointReviewResponse(PointReviewInput):
    id: UUID
    observedAtUtc: str | None = None
    reviewedAtUtc: str
    scoreVersion: str
    score: int
    classification: Literal["known", "uncatalogued", "incomplete"]
    reasons: list[str]
    identity: CatalogIdentity | None = None
    catalogReview: dict
    brightness: list[SourceMeasurement] = Field(default_factory=list)
    duplicate: ExistingEntry | None = None
    limitations: list[str]
