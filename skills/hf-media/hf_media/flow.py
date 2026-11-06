"""Dense optical flow inside one element's box: how it moves, frame to frame, as numbers.

Two uses. Comparing a rebuild with its reference on one clock (both over the same footage, so the footage's own
motion cancels): motion energy, the shape of the motion over time and the path, independent of fonts and content,
which cap SSIM. Reverse-engineering a move: the element's translation, scale and rotation per frame, cut into
moves between holds, each with the closest GSAP ease, ready to write as a tween.
"""

from __future__ import annotations

import math
from typing import Sequence

# Below this mean flow (pixels a frame at the analysis size) a frame counts as still.
STILL = 0.05
# Flow under this magnitude is noise for the affine fit.
FIT_MIN = 0.3
# Thin boxes (a caption line) are scaled up to this height; DIS flow needs room for its patches.
MIN_HEIGHT = 64

EASES = {
    "none": lambda t: t,
    "power1.in": lambda t: t**2,
    "power1.out": lambda t: 1 - (1 - t) ** 2,
    "power1.inOut": lambda t: 2 * t * t if t < 0.5 else 1 - (-2 * t + 2) ** 2 / 2,
    "power2.in": lambda t: t**3,
    "power2.out": lambda t: 1 - (1 - t) ** 3,
    "power2.inOut": lambda t: 4 * t**3 if t < 0.5 else 1 - (-2 * t + 2) ** 3 / 2,
    "power3.out": lambda t: 1 - (1 - t) ** 4,
    "power3.inOut": lambda t: 8 * t**4 if t < 0.5 else 1 - (-2 * t + 2) ** 4 / 2,
    "power4.out": lambda t: 1 - (1 - t) ** 5,
    "expo.out": lambda t: 1.0 if t >= 1 else 1 - 2 ** (-10 * t),
    "expo.inOut": lambda t: (
        0.0
        if t <= 0
        else 1.0
        if t >= 1
        else 2 ** (20 * t - 10) / 2
        if t < 0.5
        else (2 - 2 ** (-20 * t + 10)) / 2
    ),
    "sine.inOut": lambda t: -(math.cos(math.pi * t) - 1) / 2,
    "circ.out": lambda t: math.sqrt(max(0.0, 1 - (t - 1) ** 2)),
    "back.out(1.7)": lambda t: 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
}


def prepare(frames_gray, np, cv2):
    """Grey frames scaled up so the shorter side is at least MIN_HEIGHT."""
    h, w = frames_gray[0].shape
    k = max(1.0, MIN_HEIGHT / h)
    if k == 1.0:
        return frames_gray
    size = (max(16, round(w * k)), max(16, round(h * k)))
    return [cv2.resize(f, size, interpolation=cv2.INTER_LINEAR) for f in frames_gray]


def series(frames_gray, np, cv2) -> list[dict]:
    """Per pair of frames: mean flow, the share of moving pixels, and the partial affine (translation as a share
    of the box, scale, rotation in degrees) of the moving part."""
    frames_gray = prepare(frames_gray, np, cv2)
    dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    rows = []
    for a, b in zip(frames_gray, frames_gray[1:]):
        flow = dis.calc(a, b, None)
        mag = np.linalg.norm(flow, axis=2)
        h, w = a.shape
        ys, xs = np.mgrid[0:h:4, 0:w:4]
        src = np.stack([xs.ravel(), ys.ravel()], 1).astype(np.float32)
        dst = src + flow[ys.ravel(), xs.ravel()]
        moving = mag[ys, xs].ravel() > FIT_MIN
        row = {
            "mag": float(mag.mean()),
            "share": float((mag > FIT_MIN).mean()),
            "tx": 0.0,
            "ty": 0.0,
            "scale": 1.0,
            "rot": 0.0,
        }
        if moving.sum() >= 12:
            m, _ = cv2.estimateAffinePartial2D(src[moving], dst[moving])
            if m is not None:
                row.update(
                    tx=float(m[0, 2]) / w,
                    ty=float(m[1, 2]) / h,
                    scale=float(math.hypot(m[0, 0], m[1, 0])),
                    rot=float(math.degrees(math.atan2(m[1, 0], m[0, 0]))),
                )
        rows.append(row)
    return rows


def _corr(a: Sequence[float], b: Sequence[float]) -> tuple[float | None, int]:
    best: tuple[float | None, int] = (None, 0)
    for lag in range(-3, 4):
        x = a[max(0, -lag) : len(a) - max(0, lag)]
        y = b[max(0, lag) : len(b) - max(0, -lag)]
        n = min(len(x), len(y))
        if n < 4:
            continue
        x, y = x[:n], y[:n]
        mx, my = sum(x) / n, sum(y) / n
        sx = math.sqrt(sum((v - mx) ** 2 for v in x))
        sy = math.sqrt(sum((v - my) ** 2 for v in y))
        if sx < 1e-9 or sy < 1e-9:
            continue
        c = sum((p - mx) * (q - my) for p, q in zip(x, y)) / (sx * sy)
        if best[0] is None or c > best[0]:
            best = (c, lag)
    return best


def compare(ref: list[dict], cand: list[dict]) -> dict:
    """The candidate's motion against the reference's, frame for frame on one clock."""
    n = min(len(ref), len(cand))
    ref, cand = ref[:n], cand[:n]
    energy = lambda rows: sum(r["mag"] for r in rows) / max(1, len(rows))
    re_, ce = energy(ref), energy(cand)
    ref_still = re_ < STILL
    if ref_still:
        ratio = 1.0 if ce < STILL else None
    else:
        ratio = ce / re_
    corr, lag = _corr([r["mag"] for r in ref], [r["mag"] for r in cand])
    mean = lambda pairs: sum(pairs) / max(1, len(pairs))
    return {
        "frames": n,
        "ref_still": ref_still,
        "energy_ratio": None if ratio is None else round(ratio, 3),
        "motion_corr": None if corr is None else round(corr, 3),
        "lag_frames": lag,
        "path_error": round(mean([abs(a["tx"] - b["tx"]) + abs(a["ty"] - b["ty"]) for a, b in zip(ref, cand)]), 4),
        "scale_error": round(mean([abs(a["scale"] - b["scale"]) for a, b in zip(ref, cand)]), 4),
        "rotation_error": round(mean([abs(a["rot"] - b["rot"]) for a, b in zip(ref, cand)]), 3),
        "ref_motion": [round(r["mag"], 3) for r in ref],
        "candidate_motion": [round(r["mag"], 3) for r in cand],
    }


def fit_ease(progress: Sequence[float]) -> tuple[str, float]:
    """The GSAP ease whose curve is closest to a 0..1 progress curve sampled evenly over the move."""
    n = len(progress)
    if n < 2:
        return "none", 0.0
    best = ("none", float("inf"))
    for name, ease in EASES.items():
        err = sum((ease(i / (n - 1)) - p) ** 2 for i, p in enumerate(progress)) / n
        if err < best[1]:
            best = (name, err)
    return best[0], round(math.sqrt(best[1]), 4)


def track(rows: list[dict], fps: float, box: Sequence[int]) -> dict:
    """Moves between holds, each as a tween: when, how far (pixels of the source box), scale, rotation, ease."""
    x0, y0, w, h = box
    pos = [(0.0, 0.0, 1.0, 0.0)]
    for r in rows:
        x, y, s, a = pos[-1]
        pos.append((x + r["tx"] * w, y + r["ty"] * h, s * r["scale"], a + r["rot"]))
    # a frame belongs to a move when the element itself shifts, scales or turns, however slowly it eases out
    active = [
        math.hypot(r["tx"] * w, r["ty"] * h) >= 0.25 or abs(r["scale"] - 1) >= 0.003 or abs(r["rot"]) >= 0.15
        for r in rows
    ]
    moves, i = [], 0
    while i < len(active):
        if not active[i]:
            i += 1
            continue
        j = i
        while j + 1 < len(active) and (active[j + 1] or (j + 2 < len(active) and active[j + 2])):
            j += 1
        start, end = pos[i], pos[j + 1]
        span = [p[0] - start[0] for p in pos[i : j + 2]], [p[1] - start[1] for p in pos[i : j + 2]]
        dx, dy = end[0] - start[0], end[1] - start[1]
        axis = span[0] if abs(dx) >= abs(dy) else span[1]
        total = dx if abs(dx) >= abs(dy) else dy
        if abs(total) >= 1:
            progress = [v / total for v in axis]
        else:
            ds = end[2] - start[2]
            progress = [(p[2] - start[2]) / ds if abs(ds) > 1e-3 else 0.0 for p in pos[i : j + 2]]
        if j == i:
            moves.append(
                {
                    "kind": "jump",
                    "start": round(i / fps, 3),
                    "x": round(dx, 1),
                    "y": round(dy, 1),
                    "scale": round(end[2] / start[2], 3),
                }
            )
            i = j + 1
            continue
        ease, err = fit_ease(progress)
        moves.append(
            {
                "kind": "tween",
                "start": round(i / fps, 3),
                "duration": round((j + 1 - i) / fps, 3),
                "x": round(dx, 1),
                "y": round(dy, 1),
                "scale": round(end[2] / start[2], 3),
                "rotation": round(end[3] - start[3], 2),
                "ease": ease,
                "ease_error": err,
                "overshoot": round(max(0.0, max(progress) - 1.0), 3),
            }
        )
        i = j + 1
    return {"box": list(box), "fps": fps, "moves": moves, "frames": len(rows) + 1}
