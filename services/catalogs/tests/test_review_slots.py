"""A new point check replaces an abandoned one instead of being refused as busy."""
import asyncio
import threading

import pytest

from app import review
from app.errors import ApiError
from app.review import CatalogReview, ReviewSlots


class FakeRequest:
    def __init__(self):
        self.gone = False

    async def is_disconnected(self):
        return self.gone


@pytest.fixture
def slots(monkeypatch):
    """One waiting review at a time, fast polling, and a run_review that blocks for RA 10."""
    gate = threading.Event()

    def run_review(ra, dec, radius, observed, settings=None):
        if ra == 10:
            gate.wait(5)
        return CatalogReview(mode="offline", ra=ra, dec=dec, radiusArcsec=radius, observedAtUtc=observed,
                             checks=[], limitations=[])

    fake = ReviewSlots(max_active=1, max_running=2)
    monkeypatch.setattr(review, "_review_slots", fake)
    monkeypatch.setattr(review, "run_review", run_review)
    monkeypatch.setattr(review, "DISCONNECT_POLL_S", 0.01)
    monkeypatch.setattr(review, "REVIEW_SLOT_WAIT_S", 0.3)
    yield fake, gate
    gate.set()


def check(request, ra):
    return review.review(request, ra=ra, dec=10, radiusArcsec=30, observedAtUtc=None)


def test_a_new_check_replaces_one_its_client_abandoned(slots):
    fake, gate = slots

    async def scenario():
        old = FakeRequest()
        first = asyncio.ensure_future(check(old, 10))
        await asyncio.sleep(0.05)
        old.gone = True  # the viewer marked another point and aborted this request
        second = await check(FakeRequest(), 11)
        with pytest.raises(ApiError) as abandoned:
            await first
        # The abandoned review's threads are still running; they settle when its queries end.
        counts = (fake.active, fake.running)
        gate.set()
        return second, abandoned.value, counts

    second, abandoned, counts = asyncio.run(asyncio.wait_for(scenario(), 3))
    assert second.ra == 11
    assert abandoned.code == "review_abandoned"
    assert counts == (0, 1)
    assert fake.running == 0


def test_a_check_still_waited_on_keeps_its_slot(slots):
    fake, gate = slots

    async def scenario():
        first = asyncio.ensure_future(check(FakeRequest(), 10))
        await asyncio.sleep(0.05)
        with pytest.raises(ApiError) as busy:
            await check(FakeRequest(), 11)
        gate.set()
        return busy.value, await first

    busy, first = asyncio.run(asyncio.wait_for(scenario(), 3))
    assert busy.code == "review_busy" and busy.status_code == 429
    assert first.ra == 10
    assert fake.active == 0 and fake.running == 0


def test_abandoned_reviews_are_capped_and_a_new_check_waits_for_room(slots):
    fake, gate = slots
    fake.max_running = 1

    async def scenario():
        old = FakeRequest()
        first = asyncio.ensure_future(check(old, 10))
        await asyncio.sleep(0.05)
        old.gone = True
        with pytest.raises(ApiError):
            await first
        # The abandoned review still runs, so the cap is reached; the new check waits.
        second = asyncio.ensure_future(check(FakeRequest(), 11))
        await asyncio.sleep(0.05)
        assert not second.done()
        gate.set()
        return await second

    assert asyncio.run(asyncio.wait_for(scenario(), 3)).ra == 11
    assert fake.active == 0 and fake.running == 0


def test_slots_count_each_review_once():
    slots = ReviewSlots(max_active=2, max_running=3)
    a, b = slots.try_take(), slots.try_take()
    assert slots.try_take() is None
    slots.abandon(a)
    slots.abandon(a)
    assert (slots.active, slots.running) == (1, 2)
    c = slots.try_take()
    assert c is not None and slots.try_take() is None
    for ticket in (a, b, c):
        slots.finish(ticket)
    assert (slots.active, slots.running) == (0, 0)
