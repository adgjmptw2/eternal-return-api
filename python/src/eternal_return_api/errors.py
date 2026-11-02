from __future__ import annotations


class ErApiError(Exception):
    """The Open API answered with an error, or the request timed out.

    Network errors from httpx (no connection, DNS) are raised as they are.
    ``status`` is the HTTP status when the request failed at the HTTP level.
    When HTTP says 200 but the body ``code`` is an error, ``status`` is that
    code. ``api_code`` is the body ``code`` whenever there was one. Timeouts
    use 504.
    """

    def __init__(self, status: int, message: str, api_code: int | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.api_code = api_code


class ErNicknameMismatchError(ErApiError):
    """The nickname lookup returned a different player than the one asked for.

    The comparison already ignores case and full-width/half-width differences.
    """

    def __init__(self, requested: str, returned: str) -> None:
        super().__init__(409, f"Nickname lookup mismatch: requested={requested}, returned={returned}")
        self.requested = requested
        self.returned = returned
