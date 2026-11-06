"""Check a HyperFrames project against its reference in one pass and print a compact verdict.

The picture under test is --video, or a draft check render of PROJECT (``hyperframes
render -q draft`` at native size and fps) cached under the output folder. The review
measures duration, audio offset and loudness, frame-by-frame continuity over the whole
film (jumps, background flicker, extra or missing shapes the source lacks), and the
optional spec's regions, typing cadence and lip-sync, writes review.json, one contact sheet of the
moments where the draft differs most from the source and a side-by-side with
the draft's audio, then prints a short JSON summary. Each measured item is ok, note
(listed, no action needed) or fix against named bounds; a requested check that could not be
measured is unmeasured. The verdict is fix when any item needs a fix, incomplete when nothing
needs a fix but a check was not measured, and pass otherwise. Pass is not creative equivalence.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import os
import shutil
import signal
import subprocess
import sys
import time
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from typing import Any

from . import evidence

# Two tiers: a value past its NOTE bound is listed; past its FIX bound it needs a fix.
SHARPNESS_NOTE, SHARPNESS_FIX = (0.7, 1.4), (0.5, 2.0)  # draft/source high-pass, soft/glow/texture
INK_NOTE, INK_FIX = (
    (0.95, 1.05),
    (0.90, 1.10),
)  # draft/source ink-box width and height, text/caption
MOTION_NOTE, MOTION_FIX = 0.9, 0.8  # entry/exit/shadow match: below note is listed, below fix
CADENCE_NOTE, CADENCE_FIX = 2.0, 4.0  # reveal lead or lag in source frames, 5-90% of final ink
AUDIO_NOTE, AUDIO_FIX = 1.0, 2.0  # soundtrack offset in source frames
AUDIO_MATCH = 0.5  # envelope correlation below this: soundtracks differ, offset not judged
DURATION_NOTE, DURATION_FIX = 1.0, 3.0  # source frames
LIPSYNC_LATE_MS = 45.0  # fix when the picture is later than sound by more
LIPSYNC_EARLY_MS = 125.0  # fix when the picture is earlier than sound by more
LIPSYNC_NOTE_SHARE = 2 / 3  # note beyond this share of either lip-sync limit
HYPERFRAMES = "hyperframes@0.9.13"  # the CLI Desktop pins (its package.json), which npx fetches exactly
SEAM_NOTE_FRAMES = 2  # a jump/structure/flicker this short is a cut or fade a frame off: note
FLICKER_FIX = 5.0  # flicker is a fix when its still-background change exceeds the source's by this
JOIN_NOTE, JOIN_FIX = 2.0, 3.0  # source-time jump across a join, in source frames
JOIN_EVENT_RATIO = 3.0  # a jump/structure event at a join this far over the source's is a fix
MAX_FIX_ROUNDS = 3  # reviews after the first build; each new authored state is one round
ASPECT_FIX = 0.01  # draft/source width:height differing by more than this share is a fix
FPS_NOTE = 0.005  # draft/source frame rate differing by more than this share is a note
RENDER_TIMEOUT = 1800  # seconds a draft render may run
RENDER_GRACE = 5  # seconds a timed-out render gets after SIGTERM before SIGKILL
SHEET_EDGE = 1600
SHEET_TIMES = 8
WORST_GAP = 1.0  # seconds between the moments the default sheet shows
WORST_MIN = 3  # worst moments added even when spec times fill the sheet
STRUCTURE_MARK = 0.15  # marked box on the sheet, share of the width (evidence.STRUCTURE_BOX)
SOFT_KINDS = {"soft", "glow", "texture"}
TEXT_KINDS = {"text", "caption"}
EXCLUDED_DIRS = {
    "work",
    "renders",
    "output",
    ".hyperframes",
    "node_modules",
    "reference",
    ".git",
    "__pycache__",
}
VIDEO_OUTPUTS = {".mp4", ".mov", ".webm", ".mkv"}


class ReviewError(ValueError):
    """Invalid review input, or a render or transcription that could not run."""


# ---------------------------------------------------------------- spec


def _ints(value: Any, size: int) -> bool:
    return (
        isinstance(value, list)
        and len(value) == size
        and all(isinstance(v, int) and not isinstance(v, bool) for v in value)
    )


def _seconds(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0


def validate_spec(spec: Any) -> dict:
    """Return the spec with defaults, or raise ReviewError naming the bad field."""
    if not isinstance(spec, dict):
        raise ReviewError("The review spec must be a JSON object.")
    allowed = {
        "times",
        "pairs",
        "regions",
        "cadence",
        "motion",
        "mouth",
        "soft_layers",
        "joins",
        "faces",
    }
    if unknown := set(spec) - allowed:
        raise ReviewError(f"Unknown spec fields {sorted(unknown)}; allowed: {sorted(allowed)}.")
    times = spec.get("times", [])
    if not isinstance(times, list) or not all(_seconds(t) for t in times):
        raise ReviewError("spec.times must be a list of seconds >= 0, e.g. [0.5, 3, 6].")
    pairs = spec.get("pairs", [])
    if not isinstance(pairs, list) or not all(_ints(p, 2) for p in pairs):
        raise ReviewError("spec.pairs must be [[source_frame, draft_frame], ...] integers.")
    regions = spec.get("regions", {})
    if not isinstance(regions, dict):
        raise ReviewError('spec.regions must be {"name": {"box": [x,y,w,h], "kind": ...}}.')
    kinds = SOFT_KINDS | TEXT_KINDS
    for name, region in regions.items():
        where = f"spec.regions.{name}"
        if not isinstance(region, dict):
            raise ReviewError(f"{where} must be an object with box, kind and time or frames.")
        if extra := set(region) - {"box", "kind", "time", "frames", "ink"}:
            raise ReviewError(f"{where} has unknown fields {sorted(extra)}.")
        if not _ints(region.get("box"), 4) or min(region["box"][2:]) < 5:
            raise ReviewError(f"{where}.box must be [x,y,w,h] integers, at least 5x5 source px.")
        if region.get("kind") not in kinds:
            raise ReviewError(f"{where}.kind must be one of {sorted(kinds)}.")
        if ("time" in region) == ("frames" in region):
            raise ReviewError(
                f"{where} needs exactly one of time (seconds) or frames [src, draft]."
            )
        if "time" in region and not _seconds(region["time"]):
            raise ReviewError(f"{where}.time must be seconds >= 0.")
        if "frames" in region and not _ints(region["frames"], 2):
            raise ReviewError(f"{where}.frames must be [source_frame, draft_frame].")
        if region.get("ink") not in (None, "dark", "light"):
            raise ReviewError(f"{where}.ink must be dark or light.")
    cadence = spec.get("cadence", [])
    if not isinstance(cadence, list):
        raise ReviewError("spec.cadence must be a list of {name, roi, start, end}.")
    for i, item in enumerate(cadence):
        where = f"spec.cadence[{i}]"
        if not isinstance(item, dict) or set(item) - {"name", "roi", "start", "end", "draft_roi"}:
            raise ReviewError(f"{where} must be {{name, roi, start, end[, draft_roi]}}.")
        if not isinstance(item.get("name"), str) or not _ints(item.get("roi"), 4):
            raise ReviewError(f"{where} needs a name and roi [x,y,w,h].")
        if "draft_roi" in item and not _ints(item["draft_roi"], 4):
            raise ReviewError(f"{where}.draft_roi must be [x,y,w,h].")
        if not (_seconds(item.get("start")) and _seconds(item.get("end"))) or (
            item["end"] <= item["start"]
        ):
            raise ReviewError(f"{where} needs seconds 0 <= start < end.")
    motion = spec.get("motion", [])
    if not isinstance(motion, list):
        raise ReviewError("spec.motion must be a list of {name, roi, start, end}.")
    for i, item in enumerate(motion):
        where = f"spec.motion[{i}]"
        if not isinstance(item, dict) or set(item) - {"name", "roi", "start", "end", "draft_roi"}:
            raise ReviewError(f"{where} must be {{name, roi, start, end[, draft_roi]}}.")
        if not isinstance(item.get("name"), str) or not _ints(item.get("roi"), 4):
            raise ReviewError(f"{where} needs a name and roi [x,y,w,h].")
        if "draft_roi" in item and not _ints(item["draft_roi"], 4):
            raise ReviewError(f"{where}.draft_roi must be [x,y,w,h].")
        if not (_seconds(item.get("start")) and _seconds(item.get("end"))) or (
            item["end"] <= item["start"]
        ):
            raise ReviewError(f"{where} needs seconds 0 <= start < end.")
    mouth = spec.get("mouth")
    if mouth is not None:
        if not isinstance(mouth, dict) or set(mouth) - {"roi", "start", "end"}:
            raise ReviewError("spec.mouth must be {roi, start, end} in draft coordinates.")
        if not _ints(mouth.get("roi"), 4):
            raise ReviewError("spec.mouth.roi must be [x,y,w,h].")
        if not (_seconds(mouth.get("start")) and _seconds(mouth.get("end"))) or (
            mouth["end"] <= mouth["start"]
        ):
            raise ReviewError("spec.mouth needs seconds 0 <= start < end.")
    joins = spec.get("joins", [])
    if not isinstance(joins, list) or not all(_seconds(t) for t in joins):
        raise ReviewError("spec.joins must be a list of seconds where generated pieces meet.")
    faces = spec.get("faces", [])
    if not isinstance(faces, list):
        raise ReviewError("spec.faces must be a list of {name, start, end[, cast]}.")
    for i, item in enumerate(faces):
        where = f"spec.faces[{i}]"
        if not isinstance(item, dict) or set(item) - {"name", "start", "end", "cast"}:
            raise ReviewError(f"{where} must be {{name, start, end[, cast]}}.")
        if not isinstance(item.get("name"), str) or not isinstance(item.get("cast", False), bool):
            raise ReviewError(f"{where} needs a name, and cast true or false.")
        if not (_seconds(item.get("start")) and _seconds(item.get("end"))) or (
            item["end"] <= item["start"]
        ):
            raise ReviewError(f"{where} needs seconds 0 <= start < end.")
    soft = spec.get("soft_layers", [])
    if not isinstance(soft, list) or not all(isinstance(n, str) for n in soft):
        raise ReviewError("spec.soft_layers must be a list of region names.")
    return {
        "times": times,
        "pairs": pairs,
        "regions": regions,
        "cadence": cadence,
        "motion": motion,
        "mouth": mouth,
        "soft_layers": soft,
        "joins": joins,
        "faces": faces,
    }


# ---------------------------------------------------------------- draft render


def fix_round(project: Path, limit: int, *, record: bool = True) -> int:
    """Count distinct authored states reviewed; 0 is the first build. Refuse past the limit.

    With record=False the round is checked but not stored, so a state whose draft fails to
    render does not use up a round."""
    path = project / "work" / "check" / "review-rounds.json"
    try:
        states = json.loads(path.read_text(encoding="utf-8"))["states"]
    except (OSError, ValueError, KeyError):
        states = []
    state = project_hash(project)
    if state not in states:
        if len(states) > limit:
            raise ReviewError(
                f"Fix round limit reached: the first build and {limit} fix rounds are reviewed. "
                "Stop editing; restore the last reviewed files if you changed them, and list the "
                "remaining fix items in frame.md and the reply."
            )
        states.append(state)
        if not record:
            return len(states) - 1
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"states": states}, indent=1) + "\n", encoding="utf-8")
    return states.index(state)


def project_hash(project: Path) -> str:
    """Hash authored files; work/, renders, reference and root video outputs are excluded."""
    digest = hashlib.sha256()
    for path in sorted(project.rglob("*")):
        relative = path.relative_to(project)
        if (
            not path.is_file()
            or set(relative.parts[:-1]) & EXCLUDED_DIRS
            or relative.parts[0] in EXCLUDED_DIRS
            or (len(relative.parts) == 1 and path.suffix.lower() in VIDEO_OUTPUTS)
            or path.name == ".DS_Store"
        ):
            continue
        digest.update(str(relative).encode() + b"\0" + evidence.sha256(path).encode() + b"\n")
    return digest.hexdigest()


def hyperframes_command(environ: Mapping[str, str] | None = None) -> list[str]:
    """The host's HyperFrames CLI: HYPERFRAMES_CLI_BIN, then hyperframes on PATH, then npx's pinned one."""
    environ = os.environ if environ is None else environ
    if environ.get("HYPERFRAMES_CLI_BIN"):
        return [environ["HYPERFRAMES_CLI_BIN"]]
    path = environ.get("PATH")
    if found := shutil.which("hyperframes", path=path):
        return [found]
    if found := shutil.which("npx", path=path):
        return [found, "--yes", HYPERFRAMES]
    raise ReviewError(
        "No HyperFrames CLI found: set HYPERFRAMES_CLI_BIN, put hyperframes on PATH "
        "(npm install -g hyperframes, Node 22+), or pass --video with an existing render."
    )


def _stop_render(process: subprocess.Popen) -> None:
    if sys.platform == "win32":
        # No process groups on Windows: taskkill /T ends the CLI with the browser and ffmpeg it started.
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(process.pid)], capture_output=True, check=False)
        process.communicate()
        return
    # Ask first, so puppeteer closes the Chrome it launched in its own group; then force it.
    for sig, grace in ((signal.SIGTERM, RENDER_GRACE), (signal.SIGKILL, None)):
        try:
            os.killpg(process.pid, sig)
        except ProcessLookupError:
            return
        try:
            process.communicate(timeout=grace)
            return
        except subprocess.TimeoutExpired:
            continue


def _run_render(command: list[str], cwd: Path) -> None:
    # Own process group, so a timeout also stops the browser and ffmpeg the CLI started.
    with subprocess.Popen(
        command,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
    ) as process:
        try:
            stdout, stderr = process.communicate(timeout=RENDER_TIMEOUT)
        except subprocess.TimeoutExpired as exc:
            _stop_render(process)
            raise ReviewError(
                f"Draft render did not finish in {RENDER_TIMEOUT} s; check the project with "
                "hyperframes check, or pass --video with an existing render."
            ) from exc
    if process.returncode:
        tail = (stderr or stdout).strip().splitlines()[-12:]
        raise ReviewError("Draft render failed: " + " | ".join(tail))


def draft_render(
    project: Path, out: Path, *, run: Callable[[list[str], Path], None] = _run_render
) -> dict:
    """Render PROJECT once per authored-file hash to out/draft.mp4; reuse a matching draft."""
    target, record_path = out / "draft.mp4", out / "draft.json"
    key = project_hash(project)
    try:
        record = json.loads(record_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        record = {}
    if record.get("project_hash") == key and target.is_file():
        return {**record, "cached": True, "seconds": 0.0}
    partial = out / "draft.partial.mp4"
    partial.unlink(missing_ok=True)
    command = [
        *hyperframes_command(),
        "render",
        str(project),
        "-q",
        "draft",
        "-o",
        str(partial),
        "--quiet",
    ]
    began = time.monotonic()
    run(command, project)
    if not partial.is_file():
        raise ReviewError(f"The render exited cleanly but wrote no {partial}.")
    partial.replace(target)
    record = {
        "project_hash": key,
        "path": str(target),
        "command": command,
        "render_seconds": round(time.monotonic() - began, 2),
        "note": "Check render (-q draft), not an export.",
    }
    record_path.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    return {**record, "cached": False, "seconds": record["render_seconds"]}


# ---------------------------------------------------------------- measurements


def _envelope(source: dict, hop: float = 0.01):
    np = evidence._numpy()
    rate = 16000
    end = source["video"]["duration"] or source["container_duration"]
    samples = evidence._audio_samples(source, 0, end, rate).astype(np.float64)
    size = int(rate * hop)
    count = len(samples) // size
    if count < 10:
        raise evidence.EvidenceError("Too little audio to compare.")
    blocks = samples[: count * size].reshape(count, size)
    return np.sqrt((blocks**2).mean(axis=1) + 1e-12)


def audio_offset(source: dict, draft: dict, *, max_seconds: float = 1.0, hop: float = 0.01) -> dict:
    """Lag of the draft soundtrack against the source from their loudness envelopes."""
    np = evidence._numpy()
    a, b = np.log(_envelope(source, hop)), np.log(_envelope(draft, hop))
    reach = int(max_seconds / hop)
    best, best_lag = -2.0, 0
    for lag in range(-reach, reach + 1):
        x, y = (a[: len(a) - lag], b[lag:]) if lag >= 0 else (a[-lag:], b[: len(b) + lag])
        n = min(len(x), len(y))
        if n < 10 or np.std(x[:n]) == 0 or np.std(y[:n]) == 0:
            continue
        r = float(np.corrcoef(x[:n], y[:n])[0, 1])
        if r > best:
            best, best_lag = r, lag
    return {
        "offset_ms": best_lag * hop * 1000,
        "correlation": best,
        "reading": "Positive: the draft's sound is later than the source's.",
    }


def _pair_for(region: dict, source: dict, draft: dict) -> tuple[int, int]:
    if "frames" in region:
        return tuple(region["frames"])  # type: ignore[return-value]
    t = region["time"]
    a = evidence.select_times(source, [t])[0]["selected_index"]
    b = evidence.select_times(draft, [t])[0]["selected_index"]
    return a, b


def worst_moments(rows: Sequence[Mapping], *, count: int, gap: float) -> list[dict]:
    """The frames where the draft's edges differ most from the source's, at least gap s apart.

    Each frame scores the median of its +-SEAM_NOTE_FRAMES neighbours, so a cut or fade one
    or two frames off (a continuity note) does not crowd out a difference that persists.
    """
    if not rows:
        return []
    reach = SEAM_NOTE_FRAMES
    rows = [
        {
            **r,
            "structure": sorted(x["structure"] for x in rows[max(0, n - reach) : n + reach + 1])[
                len(rows[max(0, n - reach) : n + reach + 1]) // 2
            ],
        }
        for n, r in enumerate(rows)
    ]
    picked: list[Mapping] = []
    for row in sorted(rows, key=lambda r: -r["structure"]):
        if all(abs(row["seconds"] - p["seconds"]) >= gap for p in picked):
            picked.append(row)
        if len(picked) == count:
            break
    values = sorted(r["structure"] for r in rows)
    median = values[len(values) // 2] or 1e-6
    return [
        {
            "seconds": p["seconds"],
            "at": p["structure_at"],
            "x_median": round(p["structure"] / median, 1),
        }
        for p in sorted(picked, key=lambda r: r["seconds"])
    ]


def _contact_sheet(
    source: dict,
    draft: dict,
    times: list[float],
    out: Path,
    marks: Sequence[Sequence[int] | None] = (),
    labels: Sequence[str] = (),
) -> str:
    Image, ImageDraw = evidence._pillow()
    folder = out / "sheet-frames"
    shutil.rmtree(folder, ignore_errors=True)
    try:
        return _draw_sheet(Image, ImageDraw, source, draft, times, out, folder, marks, labels)
    finally:
        shutil.rmtree(folder, ignore_errors=True)


def _draw_sheet(Image, ImageDraw, source, draft, times, out, folder, marks, labels) -> str:
    left = evidence.frames(source, folder / "source", times=times, max_width=480)
    right = evidence.frames(draft, folder / "draft", times=times, max_width=480)
    w, h = left["frames"][0]["image_size"]
    label = 22
    cols = max(1, min(len(times), round(math.sqrt(len(times) * (h + label) / (2 * w)))))
    rows = math.ceil(len(times) / cols)
    sheet = Image.new("RGB", (cols * 2 * w, rows * (h + label)), "#1e1e1e")
    draw = ImageDraw.Draw(sheet)
    for i, (a, b) in enumerate(zip(left["frames"], right["frames"])):
        x, y = (i % cols) * 2 * w, (i // cols) * (h + label)
        for offset, item in ((0, a), (w, b)):
            with Image.open(item["path"]) as image:
                sheet.paste(image.convert("RGB").resize((w, h)), (x + offset, y + label))
            mark = marks[i] if i < len(marks) else None
            if mark:
                k = w / source["video"]["width"]
                cx, cy, r = mark[0] * k, mark[1] * k, STRUCTURE_MARK * w / 2
                box = (
                    x + offset + cx - r,
                    y + label + cy - r,
                    x + offset + cx + r,
                    y + label + cy + r,
                )
                draw.rectangle(box, outline="#ff3b30", width=2)
        extra = f"  {labels[i]}" if i < len(labels) else ""
        draw.text((x + 4, y + 4), f"{times[i]:.2f}s  source | draft{extra}", fill="white")
    scale = min(1.0, SHEET_EDGE / max(sheet.size))
    if scale < 1:
        sheet = sheet.resize((round(sheet.width * scale), round(sheet.height * scale)))
    path = out / "sheet.jpg"
    sheet.save(path, quality=85)
    return str(path)


def _side_by_side(source: dict, draft: dict, out: Path) -> str:
    path, record = out / "side-by-side.mp4", out / "side-by-side.json"
    key = source["sha256"] + draft["sha256"]
    if path.is_file() and record.is_file() and record.read_text(encoding="utf-8").strip() == key:
        return str(path)
    height = min(source["video"]["height"], draft["video"]["height"], 960) // 2 * 2
    rate = draft["video"]["avg_frame_rate"] or "30"
    lanes = f"fps={rate},scale=-2:{height},setsar=1"
    evidence._run(
        [
            "ffmpeg",
            "-nostdin",
            "-v",
            "error",
            "-y",
            "-i",
            source["path"],
            "-i",
            draft["path"],
            "-filter_complex",
            f"[0:v]{lanes}[a];[1:v]{lanes}[b];[a][b]hstack=inputs=2[v]",
            "-map",
            "[v]",
            "-map",
            "1:a?",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            str(path),
        ]
    )
    record.write_text(key + "\n", encoding="utf-8")
    return str(path)


def _transcribe(draft: dict, project: Path, out: Path) -> Path:
    """Transcribe the draft's audio through HeyGen; the job record lands in work/jobs."""
    from . import generation

    audio = out / "draft-audio.mp3"
    evidence._run(
        ["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", draft["path"], "-vn", "-ac", "1"]
        + ["-ar", "16000", "-c:a", "libmp3lame", "-b:a", "48k", str(audio)]
    )
    job = project / "work" / "jobs" / f"review-transcribe-{evidence.sha256(audio)[:12]}"
    if not (job / "job.json").is_file():
        payload = {
            "model": "scribe-v2",
            "diarize": True,
            "audio": {
                "type": "base64",
                "media_type": "audio/mpeg",
                "data": base64.b64encode(audio.read_bytes()).decode(),
            },
        }
        generation.create(job, "/v3/audio/transcriptions", payload, inputs=[audio])
    record = generation.inspect_job(job)
    for _ in range(20):
        if record["state"] in generation.TERMINAL:
            break
        record = generation.wait(job, seconds=30)
    if record["state"] != "succeeded":
        raise ReviewError(f"Transcription job {job} is {record['state']}; inspect it.")
    record = generation.download_outputs(job)
    result = next(o for o in record["outputs"] if o["field"] == "result")
    return job / result["path"]


# ---------------------------------------------------------------- review


def _display_aspect(video: Mapping[str, Any]) -> float | None:
    """Display width:height: pixel shape times the sample aspect ratio ("4:3", "1:1", "0:1")."""
    if not video.get("width") or not video.get("height"):
        return None
    num, _, den = str(video.get("sample_aspect_ratio") or "1:1").partition(":")
    try:
        sar = float(num) / float(den)
    except (ValueError, ZeroDivisionError):
        sar = 0.0
    return video["width"] * (sar if sar > 0 else 1.0) / video["height"]


def _rate(value: Any) -> float | None:
    """ffprobe avg_frame_rate ("30000/1001", "25/1", "0/0") as fps, or None."""
    try:
        num, _, den = str(value).partition("/")
        rate = float(num) / float(den or 1)
    except (TypeError, ValueError, ZeroDivisionError):
        return None
    return rate if rate > 0 else None


def _in_range(value: float, note: Sequence[float], fix: Sequence[float]) -> tuple[str, float]:
    """Tier and how far past the note bound toward the fix bound (0..1)."""
    if note[0] <= value <= note[1]:
        return "ok", 0.0
    if value < fix[0] or value > fix[1]:
        return "fix", 1.0
    if value < note[0]:
        return "note", (note[0] - value) / max(note[0] - fix[0], 1e-9)
    return "note", (value - note[1]) / max(fix[1] - note[1], 1e-9)


# evidence.face_summary's verdict as review tiers: a warn band slides likeness at every chained
# join, and a range whose handoff frame shows no measured face leaves the review incomplete.
FACE_TIERS = {
    "pass": ("ok", 0.0),
    "warn": ("note", 0.5),
    "fail": ("fix", 1.0),
    "unmeasured": ("unmeasured", 0.0),
}


def _below(value: float, note: float, fix: float) -> tuple[str, float]:
    return _in_range(abs(value), (-math.inf, note), (-math.inf, fix))


def _range(text: str) -> tuple[float, float]:
    try:
        low, high = (float(v) for v in text.split(","))
    except ValueError as exc:
        raise argparse.ArgumentTypeError("Expected LOW,HIGH, e.g. 0.7,1.4.") from exc
    return low, high


def review(
    project: str | Path,
    source: str | Path,
    *,
    spec: str | Path | Mapping | None = None,
    video: str | Path | None = None,
    out: str | Path | None = None,
    words: str | Path | None = None,
    transcribe: bool = False,
    times: Sequence[float] | None = None,
    sharpness_note: tuple[float, float] = SHARPNESS_NOTE,
    sharpness_fix: tuple[float, float] = SHARPNESS_FIX,
    ink_note: tuple[float, float] = INK_NOTE,
    ink_fix: tuple[float, float] = INK_FIX,
    cadence_note: float = CADENCE_NOTE,
    cadence_fix: float = CADENCE_FIX,
    audio_note: float = AUDIO_NOTE,
    audio_fix: float = AUDIO_FIX,
    duration_note: float = DURATION_NOTE,
    duration_fix: float = DURATION_FIX,
    lipsync_late_ms: float = LIPSYNC_LATE_MS,
    lipsync_early_ms: float = LIPSYNC_EARLY_MS,
    max_rounds: int = MAX_FIX_ROUNDS,
    render: Callable[[list[str], Path], None] = _run_render,
) -> dict:
    """Run every check and write review.json; return the compact summary."""
    began = time.monotonic()
    project = Path(project).expanduser().resolve()
    if not project.is_dir():
        raise ReviewError(f"Project folder not found: {project}")
    folder = Path(out).expanduser().resolve() if out else project / "work" / "check" / "review"
    folder.mkdir(parents=True, exist_ok=True)
    if transcribe and not words:
        raise ReviewError("--transcribe needs --words SELECTED_WORDS.json to compare against.")
    if isinstance(spec, (str, Path)):
        try:
            spec = json.loads(Path(spec).expanduser().read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ReviewError(f"Cannot read the review spec: {exc}") from exc
    plan = validate_spec(spec or {})
    round_number = fix_round(project, max_rounds, record=False)
    if video:
        draft_info: dict[str, Any] = {"path": str(Path(video).resolve()), "given": True}
    else:
        draft_info = draft_render(project, folder, run=render)
    fix_round(project, max_rounds)  # counted only once a draft exists
    src = evidence.probe(source)
    drf = evidence.probe(draft_info["path"])
    frame = evidence._frame_seconds(src)
    items: list[dict[str, Any]] = []
    detail: dict[str, Any] = {
        "tolerances": {
            "sharpness": {"note": sharpness_note, "fix": sharpness_fix},
            "ink": {"note": ink_note, "fix": ink_fix},
            "cadence_frames": {"note": cadence_note, "fix": cadence_fix},
            "audio_frames": {"note": audio_note, "fix": audio_fix},
            "duration_frames": {"note": duration_note, "fix": duration_fix},
            "lipsync_ms": {"late": lipsync_late_ms, "early": lipsync_early_ms},
            "flicker_fix_ratio": FLICKER_FIX,
            "join_frames": {"note": JOIN_NOTE, "fix": JOIN_FIX, "event_ratio": JOIN_EVENT_RATIO},
        }
    }

    def grade(check: str, graded: tuple[str, float], message: str) -> None:
        tier, excess = graded
        items.append({"check": check, "tier": tier, "excess": excess, "message": message})

    def attempt(
        label: str, work: Callable[..., Any], *args: Any, required: bool = True, **kwargs: Any
    ) -> Any:
        """Run one measurement; a failed required check is unmeasured, never silently passed."""
        try:
            result = work(*args, **kwargs)
        except (evidence.EvidenceError, ReviewError, OSError, KeyError, ValueError) as exc:
            tier = "unmeasured" if required else "note"
            grade(label, (tier, 0.0), f"{label}: not measured ({exc})")
            return None
        if required and not result:
            grade(label, ("unmeasured", 0.0), f"{label}: not measured (no result)")
        return result

    src_d, drf_d = src["video"]["duration"], drf["video"]["duration"]
    detail["duration"] = {"source": src_d, "draft": drf_d, "frame_seconds": frame}
    if src_d and drf_d:
        grade(
            "duration",
            _below((drf_d - src_d) / frame, duration_note + 1e-6, duration_fix + 1e-6),
            f"duration: draft {drf_d:.3f}s vs source {src_d:.3f}s",
        )

    sv, dv = src["video"], drf["video"]
    detail["shape"] = {
        "source": [sv["width"], sv["height"], sv.get("avg_frame_rate")],
        "draft": [dv["width"], dv["height"], dv.get("avg_frame_rate")],
    }
    shapes = [_display_aspect(v) for v in (sv, dv)]
    if all(shapes):
        ratio = shapes[1] / shapes[0]
        grade(
            "aspect",
            ("fix", 1.0) if abs(ratio - 1) > ASPECT_FIX else ("ok", 0.0),
            f"aspect: draft {dv['width']}x{dv['height']} ({shapes[1]:.3f}) vs source "
            f"{sv['width']}x{sv['height']} ({shapes[0]:.3f}), display width:height",
        )
    rates = [_rate(v.get("avg_frame_rate")) for v in (sv, dv)]
    if all(rates):
        grade(
            "frame rate",
            ("note", 0.5) if abs(rates[1] / rates[0] - 1) > FPS_NOTE else ("ok", 0.0),
            f"frame rate: draft {rates[1]:.3f} vs source {rates[0]:.3f} fps "
            "(cadence and lip-sync are counted in source frames)",
        )

    audio: dict[str, Any] = {}
    if not src["audio"] or not drf["audio"]:
        missing = "source" if not src["audio"] else "draft"
        audio["note"] = f"no audio in {missing}"
        if src["audio"]:
            grade("audio", ("fix", 1.0), "audio: the draft has no soundtrack; the source has one")
        elif drf["audio"]:
            grade("audio", ("note", 0.5), "audio: the draft has a soundtrack the source lacks")
    else:
        audio["offset"] = attempt("audio offset", lambda: audio_offset(src, drf))
        for side, item in (("source", src), ("draft", drf)):
            level = attempt(
                f"{side} loudness",
                evidence.loudness,
                item,
                windows=[[0, item["video"]["duration"] or item["container_duration"]]],
            )
            audio[f"{side}_lufs"] = level["windows"][0]["integrated_lufs"] if level else None
            audio[f"{side}_measured"] = bool(level)
        if (
            audio["draft_measured"]
            and audio["source_lufs"] is not None
            and audio["draft_lufs"] is None
        ):
            grade(
                "audio", ("fix", 1.0), "audio: the draft soundtrack is silent; the source's is not"
            )
        offset = audio.get("offset")
        if offset and offset["correlation"] >= AUDIO_MATCH:
            grade(
                "audio offset",
                _below(offset["offset_ms"] / 1000 / frame, audio_note + 1e-6, audio_fix + 1e-6),
                f"audio offset {offset['offset_ms']:+.0f} ms (corr {offset['correlation']:.2f})",
            )
        elif offset:
            audio["note"] = (
                f"soundtracks differ (corr {offset['correlation']:.2f}); offset not judged"
            )
            grade(
                "audio match",
                ("note", 0.5),
                f"audio: the draft soundtrack differs from the source (corr "
                f"{offset['correlation']:.2f}); offset not judged",
            )
    detail["audio"] = audio

    seams_root = folder / "continuity"
    shutil.rmtree(seams_root, ignore_errors=True)
    seams = attempt("continuity", evidence.continuity, src, drf, seams_root)
    if seams:
        detail["continuity"] = {"path": seams["manifest_path"], "events": seams["events"]}
        for event in seams["events"]:
            kind, value, base = event["kind"], event["peak_value"], event["source_value"] or 0.0
            label = (
                f"continuity {kind} {event['start_seconds']:.2f}-{event['end_seconds']:.2f}s "
                f"(frames {event['start_frame']}-{event['end_frame']})"
            )
            frames = event["end_frame"] - event["start_frame"] + 1
            at_join = (
                kind != "flicker"
                and value >= JOIN_EVENT_RATIO * base
                and any(
                    event["start_seconds"] - 2 * frame <= j <= event["end_seconds"] + 2 * frame
                    for j in plan["joins"]
                )
            )
            minor = not at_join and (
                frames <= SEAM_NOTE_FRAMES or (kind == "flicker" and value < FLICKER_FIX * base)
            )
            tier = "note" if minor else "fix"
            grade(
                label,
                (tier, 1.0 if tier == "fix" else 0.5),
                f"{label}: {value:.1f} vs source {base:.1f}; sheet {event['sheet']}",
            )

    if plan["joins"]:
        timing = attempt("join timing", evidence.join_timing, src, drf, plan["joins"])
        if timing:
            detail["joins"] = timing["joins"]
            for j in timing["joins"]:
                label = f"join {j['at']:.2f}s"
                if j["jump_seconds"] is None and j.get("timed") is False:
                    grade(label, ("note", 0.5), f"{label}: not timed ({j['reason']})")
                    continue
                if j["jump_seconds"] is None:
                    grade(label, ("unmeasured", 0.0), f"{label}: not measured ({j['reason']})")
                    continue
                grade(
                    label,
                    _below(j["jump_seconds"] / frame, JOIN_NOTE, JOIN_FIX),
                    f"{label}: picture jumps {j['jump_seconds']:+.3f}s in source time "
                    f"(offset {j['offset_before']:+.3f}s before, {j['offset_after']:+.3f}s after)",
                )

    regions: dict[str, Any] = {}
    groups: dict[tuple[int, int], dict[str, Any]] = {}
    for name, region in plan["regions"].items():
        pair = attempt(f"region {name}", _pair_for, region, src, drf)
        if pair:
            box = {"box": region["box"], **({"ink": region["ink"]} if "ink" in region else {})}
            groups.setdefault(pair, {})[name] = box
    compare_root = folder / "compare"
    shutil.rmtree(compare_root, ignore_errors=True)
    for number, (pair, boxes) in enumerate(groups.items()):
        result = attempt(
            "regions " + ",".join(boxes),
            evidence.compare,
            src,
            drf,
            compare_root / f"{number:02d}",
            pairs=[list(pair)],
            regions=boxes,
        )
        if not result:
            continue
        measured_names = result["pairs"][0]["regions"]
        for name in boxes:
            if name not in measured_names:
                grade(
                    f"region {name}",
                    ("unmeasured", 0.0),
                    f"region {name}: not measured (no result)",
                )
        for name, metrics in measured_names.items():
            kind = plan["regions"][name]["kind"]
            entry = {
                "kind": kind,
                "frames": list(pair),
                "sharpness_ratio": metrics["sharpness_ratio"],
                "detail_ratio": metrics["detail_ratio"],
                "mae_rgb_255": metrics["mae_rgb_255"],
                "ink_size_ratio": metrics["ink"]["size_ratio"],
                "pair_image": result["pairs"][0]["path"],
            }
            regions[name] = entry
            ratio = metrics["sharpness_ratio"]
            label = f"region {name} ({kind})"
            if kind in SOFT_KINDS:
                if ratio is None:
                    grade(label, ("fix", 1.0), f"{label}: no texture to measure in the source")
                else:
                    grade(
                        label,
                        _in_range(ratio, sharpness_note, sharpness_fix),
                        f"{label}: sharpness_ratio {ratio:.2f}",
                    )
            if kind in TEXT_KINDS:
                size = metrics["ink"]["size_ratio"]
                if not size:
                    grade(label, ("fix", 1.0), f"{label}: no ink on one side")
                else:
                    graded = max(
                        (_in_range(size[k], ink_note, ink_fix) for k in ("width", "height")),
                        key=lambda g: (g[0] == "fix", g[0] == "note", g[1]),
                    )
                    grade(
                        label,
                        graded,
                        f"{label}: ink w {size['width']:.2f} h {size['height']:.2f}",
                    )
    detail["regions"] = regions
    for name in plan["soft_layers"]:
        measured = regions.get(name)
        if (
            not measured
            or measured["kind"] not in SOFT_KINDS
            or measured["sharpness_ratio"] is None
        ):
            grade(
                f"soft layer {name}",
                ("unmeasured", 0.0),
                f"soft layer {name}: unchecked (no measured soft/glow/texture region)",
            )

    pairs = []
    if plan["pairs"]:
        whole = attempt(
            "pairs",
            lambda: evidence.compare(src, drf, compare_root / "pairs", pairs=plan["pairs"]),
        )
        for item in (whole or {}).get("pairs", []):
            pairs.append(
                {
                    "frames": [item["reference"]["index"], item["candidate"]["index"]],
                    "mae_rgb_255": item["mae_rgb_255"],
                    "psnr_db": item["psnr_db"],
                    "pair_image": item["path"],
                }
            )
    detail["pairs"] = pairs

    cadence = {}
    for item in plan["cadence"]:
        result = attempt(
            f"cadence {item['name']}",
            evidence.cadence,
            src,
            roi=item["roi"],
            start=item["start"],
            end=item["end"],
            candidate=drf,
            candidate_roi=item.get("draft_roi"),
        )
        if not result:
            continue
        c = result["candidate"]
        cadence[item["name"]] = {
            "events_source": len(result["events"]),
            "max_lead_frames": c["max_lead_frames"],
            "max_lag_frames": c["max_lag_frames"],
            "median_lead_frames": c["median_lead_frames"],
        }
        worst = max(c["max_lead_frames"], c["max_lag_frames"])
        grade(
            f"cadence {item['name']}",
            _below(worst, cadence_note + 1e-6, cadence_fix + 1e-6),
            f"cadence {item['name']}: lead {c['max_lead_frames']:.1f} / "
            f"lag {c['max_lag_frames']:.1f} frames",
        )
    detail["cadence"] = cadence

    motions = {}
    motion_root = folder / "motion"
    shutil.rmtree(motion_root, ignore_errors=True)
    for item in plan["motion"]:
        result = attempt(
            f"motion {item['name']}",
            evidence.motion,
            src,
            drf,
            motion_root / item["name"],
            roi=item["roi"],
            start=item["start"],
            end=item["end"],
            candidate_roi=item.get("draft_roi"),
        )
        if not result:
            continue
        motions[item["name"]] = {
            k: result[k] for k in ("lag_frames", "match", "overall_match", "shadow_match", "strip")
        }
        weakest = min(
            (p for p in result["match"] if result["match"][p] is not None),
            key=lambda p: result["match"][p],
        )
        score = min(result["overall_match"], result["shadow_match"])
        part = "shadow" if result["shadow_match"] < result["overall_match"] else weakest
        graded = max(
            [
                _below(1 - score, 1 - MOTION_NOTE + 1e-6, 1 - MOTION_FIX + 1e-6),
                _below(abs(result["lag_frames"]), cadence_note + 1e-6, cadence_fix + 1e-6),
            ],
            key=lambda g: (g[0] == "fix", g[0] == "note", g[1]),
        )
        grade(
            f"motion {item['name']}",
            graded,
            f"motion {item['name']}: match {score:.2f} (lowest: {part}), "
            f"lag {result['lag_frames']:+d} frames; strip {result['strip']}",
        )
    detail["motion"] = motions

    if plan["mouth"]:
        m = plan["mouth"]
        sync = attempt(
            "lip-sync",
            lambda: evidence.av_sync(drf, mouth_roi=m["roi"], start=m["start"], end=m["end"]),
        )
        if sync:
            lag = sync["best_lag_ms"]
            detail["lipsync"] = {
                "best_lag_ms": lag,
                "confidence": sync["confidence"],
                "peak_correlation": sync["peak_correlation"],
            }
            if sync["confidence"] not in ("high", "medium"):
                grade(
                    "lip-sync", ("unmeasured", 0.0), f"lip-sync: unchecked ({sync['confidence']})"
                )
            else:
                share = LIPSYNC_NOTE_SHARE
                graded = _in_range(
                    lag,
                    (-lipsync_early_ms * share, lipsync_late_ms * share),
                    (-lipsync_early_ms, lipsync_late_ms),
                )
                grade("lip-sync", graded, f"lip-sync: picture {lag:+.0f} ms ({sync['confidence']})")

    faces = {}
    for item in plan["faces"]:
        size = attempt(
            f"face size {item['name']}",
            evidence.face_size,
            drf,
            start=item["start"],
            end=item["end"],
            cast=item.get("cast", False),
        )
        if not size:
            continue
        verdict = size["verdict"]
        faces[item["name"]] = {
            k: size[k] for k in ("face_height", "last_face_height", "last_frame", "verdict")
        }
        share = [
            "no face found" if h is None else f"{h:.0%} of frame height"
            for h in (size["face_height"], size["last_face_height"])
        ]
        grade(
            f"face size {item['name']}",
            FACE_TIERS[verdict],
            f"face size {item['name']}: median {share[0]}; last frame: {share[1]} ({verdict})",
        )
    detail["faces"] = faces

    if transcribe and words:
        result = attempt(
            "word drift",
            lambda: evidence.word_drift(words, _transcribe(drf, project, folder)),
        )
        if result:
            detail["word_drift"] = {
                k: result[k]
                for k in (
                    "matched_words",
                    "median_offset_seconds",
                    "max_abs_offset_seconds",
                    "drift_seconds_per_minute",
                    "missing",
                    "extra",
                    "replaced",
                )
            }
            offset = result["median_offset_seconds"]
            grade(
                "word offset",
                _below(offset / frame, audio_note + 1e-6, audio_fix + 1e-6),
                f"words: median offset {offset:+.3f}s",
            )
            changed = len(result["missing"]) + len(result["extra"]) + len(result["replaced"])
            grade(
                "word changes",
                ("fix", 1.0) if changed else ("ok", 0.0),
                f"words: {changed} missing/extra/replaced spans",
            )
    else:
        detail["word_drift"] = "not run (use --transcribe when speech changed)"

    span = min(src_d or 0, drf_d or 0)
    # Default sheet: where the draft differs most from the source, not evenly spaced times.
    worst = (
        worst_moments(seams.get("frames") or [], count=SHEET_TIMES, gap=WORST_GAP) if seams else []
    )
    detail["worst"] = worst
    marks: list[Any] = []
    labels: list[str] = []
    chosen = list(times or plan["times"])
    if not times and worst:
        # Spec times keep their place; the worst moments fill the sheet (all of it without a spec).
        room = SHEET_TIMES - len(chosen) if chosen else SHEET_TIMES
        extra = [w for w in worst if all(abs(w["seconds"] - t) >= WORST_GAP for t in chosen)]
        extra = sorted(extra, key=lambda w: -w["x_median"])[: max(room, WORST_MIN)]
        shown = sorted(
            [(t, None, "") for t in chosen]
            + [(w["seconds"], w["at"], f"diff x{w['x_median']} median") for w in extra]
        )
        chosen = [t for t, _, _ in shown]
        marks = [m for _, m, _ in shown]
        labels = [label for _, _, label in shown]
    chosen = chosen or [round(span * (i + 0.5) / SHEET_TIMES, 2) for i in range(SHEET_TIMES)]
    chosen = [min(t, max(0.0, span - frame)) for t in chosen]
    paths = {
        "review_json": str(folder / "review.json"),
        "sheet": attempt(
            "contact sheet",
            lambda: _contact_sheet(src, drf, chosen, folder, marks, labels),
            required=False,
        ),
        "side_by_side": attempt(
            "side-by-side", lambda: _side_by_side(src, drf, folder), required=False
        ),
        "draft": draft_info["path"],
    }
    fixes = [i["message"] for i in items if i["tier"] == "fix"]
    notes = sorted((i for i in items if i["tier"] == "note"), key=lambda i: -i["excess"])
    unmeasured = [i["message"] for i in items if i["tier"] == "unmeasured"]
    summary = {
        "verdict": "fix" if fixes else "incomplete" if unmeasured else "pass",
        "fix": fixes[:20]
        + ([f"+{len(fixes) - 20} more in review.json"] if len(fixes) > 20 else []),
        "unmeasured": unmeasured,
        "notes": {"count": len(notes), "top": [i["message"] for i in notes[:3]]},
        "ok": sum(i["tier"] == "ok" for i in items),
        "worst": [
            f"{w['seconds']:.2f}s at {w['at']}: edges differ x{w['x_median']} the film median"
            for w in sorted(worst, key=lambda w: -w["x_median"])[:3]
        ],
        "measured": {
            "continuity_events": len(seams["events"]) if seams else None,
            "regions": len(regions),
            "cadence": len(cadence),
            "motion": len(motions),
            "lipsync": "lipsync" in detail,
            "word_drift": isinstance(detail["word_drift"], dict),
            "audio_offset_ms": (audio.get("offset") or {}).get("offset_ms"),
        },
        "draft": {
            "cached": draft_info.get("cached", False),
            "render_seconds": draft_info.get("seconds", 0.0),
            "given": bool(video),
        },
        "paths": paths,
        "seconds": round(time.monotonic() - began, 1),
        "round": f"{round_number}/{max_rounds}"
        + (
            " final: stop editing; list the remaining fix items in frame.md and the reply"
            if round_number >= max_rounds
            else ""
        ),
        "reading": "fix: past the fix bound. note: past the note bound, no action needed. "
        "incomplete: nothing to fix, but the unmeasured checks did not run; fix the input or "
        "spec and review again, or report them as unchecked. pass is not creative equivalence.",
    }
    evidence._dump(
        folder / "review.json",
        {
            "project": str(project),
            "source": evidence._source_summary(src),
            "draft": {**draft_info, **evidence._source_summary(drf)},
            "spec": plan,
            "items": items,
            **detail,
            "summary": summary,
        },
    )
    return summary


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="hf-media review", description=__doc__)
    parser.add_argument("project", help="HyperFrames project folder.")
    parser.add_argument("--source", required=True, help="Reference video.")
    parser.add_argument(
        "--spec",
        help="Review spec JSON (times, pairs, regions, cadence, motion, mouth, joins, faces).",
    )
    parser.add_argument("--video", help="Check this render instead of making a draft.")
    parser.add_argument("--out", help="Output folder; default PROJECT/work/check/review.")
    parser.add_argument("--words", help="Word timings of the selected soundtrack.")
    parser.add_argument(
        "--transcribe",
        action="store_true",
        help="Transcribe the draft with HeyGen and compare with --words.",
    )
    parser.add_argument("--times", help="Sheet times in seconds, e.g. 0.5,3,6.")
    for name, note, fix, kind in (
        ("sharpness", SHARPNESS_NOTE, SHARPNESS_FIX, _range),
        ("ink", INK_NOTE, INK_FIX, _range),
        ("cadence", CADENCE_NOTE, CADENCE_FIX, float),
        ("audio", AUDIO_NOTE, AUDIO_FIX, float),
        ("duration", DURATION_NOTE, DURATION_FIX, float),
    ):
        unit = "LOW,HIGH ratio" if kind is _range else "source frames"
        parser.add_argument(f"--{name}-note", type=kind, default=note, help=f"Note bound ({unit}).")
        parser.add_argument(f"--{name}-fix", type=kind, default=fix, help=f"Fix bound ({unit}).")
    parser.add_argument("--lipsync-late-ms", type=float, default=LIPSYNC_LATE_MS)
    parser.add_argument("--lipsync-early-ms", type=float, default=LIPSYNC_EARLY_MS)
    parser.add_argument(
        "--max-rounds",
        type=int,
        default=MAX_FIX_ROUNDS,
        help="Fix rounds reviewed after the first build; a further edited state is refused.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = vars(build_parser().parse_args(argv))
    try:
        if args["times"]:
            args["times"] = [float(t) for t in args["times"].split(",")]
        result = review(args.pop("project"), args.pop("source"), **args)
    except (ReviewError, evidence.EvidenceError, OSError, ValueError) as exc:
        print(json.dumps({"error": str(exc), "tool": "review"}), file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
