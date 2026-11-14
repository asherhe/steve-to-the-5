from typing import Annotated
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


class Coordinates(BaseModel):
    ra: RA
    dec: DEC


class Mark(Coordinates):
    model_config = ConfigDict(extra="forbid")
    frameId: EvidenceId


class FindingInput(Coordinates):
    model_config = ConfigDict(extra="forbid")
    comparisonId: EvidenceId
    title: Title
    note: DiscussionText
    marks: Annotated[list[Mark], Field(max_length=20)] = Field(default_factory=list)


class ReplyInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: DiscussionText


class CreatedFinding(BaseModel):
    id: UUID


class Pin(Coordinates):
    id: UUID
    title: str


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


class Finding(Pin):
    comparisonId: EvidenceId
    note: str
    marks: list[Mark]
    authorDisplayName: str
    createdAtUtc: str
    replies: list[Reply]
