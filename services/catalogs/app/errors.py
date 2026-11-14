"""Shared error model: a {code, message} body for every error response.

Matches the contract: malformed requests, missing records and unauthorized writes use the
same shape. Writes are not part of this slice, so only invalid_request / not_found /
upstream_unavailable are produced here.
"""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


class ApiError(Exception):
    """An error that maps directly to a {code, message} body and an HTTP status."""

    def __init__(self, code: str, message: str, status_code: int) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


def invalid_request(message: str) -> ApiError:
    return ApiError("invalid_request", message, 400)


def not_found(message: str) -> ApiError:
    return ApiError("not_found", message, 404)


def upstream_unavailable(message: str) -> ApiError:
    return ApiError("upstream_unavailable", message, 503)


def _body(code: str, message: str) -> dict:
    return {"code": code, "message": message}


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _handle_api_error(_: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content=_body(exc.code, exc.message))

    @app.exception_handler(Exception)
    async def _handle_unexpected(_: Request, exc: Exception) -> JSONResponse:
        # Never leak internals in the public body.
        return JSONResponse(
            status_code=500,
            content=_body("internal_error", "An unexpected error occurred."),
        )
