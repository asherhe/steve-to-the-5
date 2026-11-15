"""Schedule promising downloads using SIA footprints, never approve comparisons.

The target's fractional position within an ordered detector footprint is a cheap
proxy for similar observing geometry. Wavelength, coverage and alignment are still
tested on the actual cutouts by processing.select. Missing/unsupported polygons
fall back to the time/detector sampler without dropping any observations.
"""
import numpy as np


def footprint_position(region, field):
    try:
        parts = region.split()
        if parts[:2] != ["POLYGON", "ICRS"]:
            return None
        corners = np.asarray([float(v) for v in parts[2:]], dtype=float).reshape(-1, 2)
        if len(corners) == 5 and np.allclose(corners[0], corners[-1]):
            corners = corners[:4]
        if corners.shape != (4, 2) or not np.isfinite(corners).all():
            return None
        # Tangent projection about the target: handles RA wrap and polar fields.
        lon, lat = np.radians(corners[:, 0] - field.ra), np.radians(corners[:, 1])
        dec = np.radians(field.dec)
        denominator = np.sin(dec) * np.sin(lat) + np.cos(dec) * np.cos(lat) * np.cos(lon)
        if np.any(denominator <= 0):
            return None
        xy = np.column_stack((np.cos(lat) * np.sin(lon) / denominator,
                              (np.cos(dec) * np.sin(lat) - np.sin(dec) * np.cos(lat) * np.cos(lon)) / denominator))
        u = (xy[1] - xy[0] + xy[2] - xy[3]) / 2
        v = (xy[3] - xy[0] + xy[2] - xy[1]) / 2
        position = np.linalg.solve(np.column_stack((u, v)), -xy.mean(axis=0))
        return position if np.isfinite(position).all() and np.max(np.abs(position)) <= 0.51 else None
    except (AttributeError, ValueError, np.linalg.LinAlgError):
        return None


def order_candidates(observations, field, config):
    groups = {}
    for observation in sorted(observations, key=lambda o: (o.start_mjd, o.detector, o.observation_id)):
        groups.setdefault(observation.detector, []).append(observation)
    pairs = []
    for detector in sorted(groups):
        located = [(o, footprint_position(o.footprint_icrs, field)) for o in groups[detector]]
        located = [(o, p) for o, p in located if p is not None]
        for index, (a, pa) in enumerate(located):
            for b, pb in located[index + 1:]:
                days = b.start_mjd - a.start_mjd
                if days >= config.priority_min_baseline_days:
                    pairs.append((float(np.linalg.norm(pa - pb)), -days, detector,
                                  a.observation_id, b.observation_id, a, b))
    ordered, seen = [], set()
    def add(observation):
        key = (observation.observation_id, observation.detector)
        if key not in seen:
            ordered.append(observation)
            seen.add(key)
    for *_, a, b in sorted(pairs, key=lambda p: p[:5]):
        for observation in (a, b):
            if len(ordered) < config.footprint_priority_cutouts:
                add(observation)
        if len(ordered) >= config.footprint_priority_cutouts:
            break
    # Keep every other candidate eligible; the normal cutout budget still applies.
    while any(groups.values()):
        for detector in sorted(groups):
            group = groups[detector]
            if group:
                add(group.pop(0))
            if group:
                add(group.pop())
    return ordered
