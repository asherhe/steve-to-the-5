"""Display-only progress and cooperative cancellation shared by both surveys."""
from contextlib import contextmanager
import re
import threading
import time

from .models import ArchiveError, Deadline


class CancellableDeadline(Deadline):
    def __init__(self, seconds, clock, cancel):
        super().__init__(seconds, clock)
        self.cancel = cancel

    def expired(self):
        return self.cancel.is_set() or super().expired()

    def check(self, stage):
        if self.cancel.is_set():
            raise ArchiveError("BUILD_CANCELLED", "Build cancelled; nothing was published", 409,
                               details={"limit": "cancelled", "stage": stage})
        super().check(stage)


class BuildCoordinator:
    """One build per process. Random progress IDs are cancellation capabilities."""
    def __init__(self):
        self.building = threading.Lock()
        self.lock = threading.Lock()
        self.progress = {}

    @staticmethod
    def validate(progress_id):
        if progress_id is not None and not re.fullmatch(r"[A-Za-z0-9-]{8,64}", progress_id):
            raise ArchiveError("INVALID_REQUEST", "progressId must be 8–64 letters, digits or hyphens", 422)

    def read(self, progress_id):
        with self.lock:
            state = self._state(progress_id)
            return {**state["latest"], "elapsedSeconds": round(time.monotonic() - state["started"], 1)}

    def _state(self, progress_id):
        if progress_id not in self.progress:
            raise ArchiveError("NOT_FOUND", "No running build has this progress ID", 404)
        return self.progress[progress_id]

    def cancel(self, progress_id):
        with self.lock:
            self._state(progress_id)["cancel"].set()
        return {"cancelled": True}

    @contextmanager
    def run(self, progress_id):
        self.validate(progress_id)
        if not self.building.acquire(blocking=False):
            raise ArchiveError("BUILD_BUSY", "Another comparison build is running; retry shortly. "
                               "Saved comparisons remain available by ID.", 429)
        cancel = threading.Event()

        def report(state):
            with self.lock:
                if progress_id in self.progress:
                    self.progress[progress_id]["latest"] = state

        try:
            if progress_id is not None:
                with self.lock:
                    self.progress[progress_id] = {"started": time.monotonic(), "cancel": cancel,
                                                 "latest": {"stage": "discovery", "done": 0,
                                                            "total": 1, "fraction": 0.0}}
            yield report, cancel
        finally:
            with self.lock:
                self.progress.pop(progress_id, None)
            self.building.release()
