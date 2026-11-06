"""Extract and measure video evidence with source hashes and native timestamps.

All frame ranges are zero-based and half-open. Frame indices enumerate ffprobe's
decoded presentation order; time queries use those frames' actual timestamps,
never ``round(seconds * fps)``. Returned image paths must still be attached or
opened by the calling Agent for inspection.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import shutil
import subprocess
import sys
import tempfile
from bisect import bisect_left, bisect_right
from collections import Counter
from collections.abc import Callable, Mapping, Sequence
from fractions import Fraction
from pathlib import Path
from typing import Any

from hf_media import flow as flow_math

SCHEMA = "omni-ref/evidence@1"
VERSION = "1.0.0"


class EvidenceError(ValueError):
    """Invalid evidence input or an operation that cannot preserve its contract."""


def sha256(path: str | Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _run(args: Sequence[str], *, timeout: float = 600, stderr: bool = False) -> bytes:
    try:
        result = subprocess.run(args, capture_output=True, timeout=timeout, check=False)
    except FileNotFoundError as exc:
        raise EvidenceError(f"{args[0]} is required on PATH.") from exc
    except subprocess.TimeoutExpired as exc:
        raise EvidenceError(f"{args[0]} exceeded {timeout:g} seconds.") from exc
    if result.returncode:
        raise EvidenceError(f"{args[0]} failed: {result.stderr.decode(errors='replace')[-4000:]}")
    return result.stderr if stderr else result.stdout


def _numpy():
    try:
        import numpy
    except ImportError as exc:
        raise EvidenceError(
            "Install the skill's numpy dependency to measure/decode frames."
        ) from exc
    return numpy


def _pillow():
    try:
        from PIL import Image, ImageDraw
    except ImportError as exc:
        raise EvidenceError(
            "Install the skill's Pillow dependency to write evidence images."
        ) from exc
    return Image, ImageDraw


def _opencv():
    try:
        import cv2
    except ImportError as exc:
        raise EvidenceError(
            "Install opencv-python-headless for image matching or plane fitting."
        ) from exc
    return cv2


def _number(value: Any) -> float | None:
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (ValueError, TypeError):
        return None


def _rational(value: Any) -> Fraction | None:
    try:
        return Fraction(str(value))
    except (ValueError, ZeroDivisionError):
        return None


def _integer(value: Any) -> int | None:
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


def _dump(path: str | Path, value: dict) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=path.parent, delete=False
    ) as handle:
        handle.write(raw)
        temporary = Path(handle.name)
    temporary.replace(path)


def _save(folder: Path, data: dict, name: str = "manifest.json") -> dict:
    for key in ("source", "reference", "candidate"):
        source = data.get(key)
        if isinstance(source, dict) and source.get("path") and source.get("sha256"):
            if sha256(source["path"]) != source["sha256"]:
                raise EvidenceError(
                    "Source changed during the evidence operation; partial files have no accepted manifest."
                )
    data = {"schema": SCHEMA, "tool": {"name": "evidence", "version": VERSION}, **data}
    data["manifest_path"] = str(folder / name)
    _dump(data["manifest_path"], data)
    return data


def _new_folder(output: str | Path) -> Path:
    folder = Path(output).expanduser().resolve()
    if folder.exists() and (not folder.is_dir() or any(folder.iterdir())):
        raise EvidenceError(f"Evidence output must be a new or empty directory: {folder}")
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def probe(path: str | Path) -> dict:
    """Read stream metadata and native video PTS. Audio-only media is valid.

    PTS intervals are reported directly. Non-uniform ticks are not automatically
    called VFR: a coarse container time base can quantize a constant-rate source.
    """
    path = Path(path).expanduser().resolve()
    if not path.is_file():
        raise EvidenceError(f"Source media does not exist: {path}")
    digest = sha256(path)
    raw = json.loads(
        _run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)])
    )
    streams = raw.get("streams", [])
    videos = [
        s
        for s in streams
        if s.get("codec_type") == "video" and not s.get("disposition", {}).get("attached_pic")
    ]
    audio = [
        {
            k: s[k]
            for k in (
                "index",
                "codec_name",
                "time_base",
                "start_time",
                "duration",
                "sample_rate",
                "channels",
                "channel_layout",
            )
            if k in s
        }
        for s in streams
        if s.get("codec_type") == "audio"
    ]
    result = {
        "schema": SCHEMA,
        "kind": "source",
        "path": str(path),
        "sha256": digest,
        "bytes": path.stat().st_size,
        "format": raw.get("format", {}).get("format_name"),
        "container_duration": _number(raw.get("format", {}).get("duration")),
        "video": None,
        "audio": audio,
        "frames": [],
    }
    if not videos:
        if not audio:
            raise EvidenceError("Source contains neither a video stream nor an audio stream.")
        if sha256(path) != digest:
            raise EvidenceError(
                "Source changed while it was being probed; retry against an immutable source."
            )
        return result
    video = videos[0]
    time_base = _rational(video.get("time_base"))
    if time_base is None or time_base <= 0:
        raise EvidenceError(
            "Video has no positive time base; normalize explicitly and retain a source mapping."
        )
    frame_data = json.loads(
        _run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                str(video["index"]),
                "-show_frames",
                "-show_entries",
                "frame=pts,best_effort_timestamp,pkt_duration,duration,width,height,key_frame,pict_type",
                "-of",
                "json",
                str(path),
            ]
        )
    )
    frames: list[dict[str, Any]] = []
    for index, frame in enumerate(frame_data.get("frames", [])):
        pts = _integer(frame.get("pts"))
        basis = "pts"
        if pts is None:
            pts = _integer(frame.get("best_effort_timestamp"))
            basis = "best_effort_timestamp"
        if pts is None:
            raise EvidenceError(
                f"Decoded frame {index} has no usable timestamp. Explicit source normalization is required."
            )
        if frames and pts <= frames[-1]["pts"]:
            raise EvidenceError(
                "Decoded PTS are not strictly increasing. Normalize explicitly; do not infer frame timing from fps."
            )
        if (frame.get("width", video["width"]), frame.get("height", video["height"])) != (
            video["width"],
            video["height"],
        ):
            raise EvidenceError(
                "A stream changes dimensions; split/normalize it with an explicit source mapping first."
            )
        duration = _integer(frame.get("duration", frame.get("pkt_duration")))
        frames.append(
            {
                "index": index,
                "pts": pts,
                "pts_basis": basis,
                "timestamp": float(pts * time_base),
                "duration_ticks": duration if duration and duration > 0 else None,
                "key_frame": bool(frame.get("key_frame")),
                "picture_type": frame.get("pict_type"),
            }
        )
    if not frames:
        raise EvidenceError("Video has no decodable timestamped frames.")
    origin = frames[0]["pts"]
    for i, frame in enumerate(frames):
        frame["seconds"] = float((frame["pts"] - origin) * time_base)
        if i + 1 < len(frames):
            frame["duration_seconds"] = float((frames[i + 1]["pts"] - frame["pts"]) * time_base)
            frame["duration_basis"] = "next_pts"
        elif frame["duration_ticks"]:
            frame["duration_seconds"] = float(frame["duration_ticks"] * time_base)
            frame["duration_basis"] = "reported_frame_duration"
        else:
            duration = None
            stream_end = _number(video.get("duration"))
            stream_start = _number(video.get("start_time"))
            if (
                stream_end is not None
                and stream_start is not None
                and stream_start + stream_end > frame["timestamp"]
            ):
                duration = stream_start + stream_end - frame["timestamp"]
            frame["duration_seconds"] = duration
            frame["duration_basis"] = "stream_end" if duration is not None else "unknown"
    deltas = Counter(b["pts"] - a["pts"] for a, b in zip(frames, frames[1:]))
    rotation = next(
        (s.get("rotation") for s in video.get("side_data_list", []) if "rotation" in s), 0
    )
    transfer = video.get("color_transfer")
    last = frames[-1]
    result["video"] = {
        "stream_index": video["index"],
        "width": video["width"],
        "height": video["height"],
        "time_base": str(time_base),
        "first_pts": origin,
        "origin_timestamp": float(origin * time_base),
        "r_frame_rate": video.get("r_frame_rate"),
        "avg_frame_rate": video.get("avg_frame_rate"),
        "frame_count": len(frames),
        "rotation_degrees": rotation,
        "sample_aspect_ratio": video.get("sample_aspect_ratio", "1:1"),
        "color_transfer": transfer,
        "color_space": video.get("color_space"),
        "color_primaries": video.get("color_primaries"),
        "pixel_format": video.get("pix_fmt"),
        "hdr": transfer in ("smpte2084", "arib-std-b67"),
        "duration": last["seconds"] + last["duration_seconds"]
        if last["duration_seconds"] is not None
        else None,
        "pts_intervals": [
            {"ticks": tick, "seconds": float(tick * time_base), "count": count}
            for tick, count in sorted(deltas.items())
        ],
        "cadence": "uniform_pts"
        if len(deltas) == 1
        else "nonuniform_pts"
        if deltas
        else "single_frame",
        "clock_note": "PTS are authoritative. Nonuniform PTS may reflect VFR or container quantization; nominal fps is metadata only.",
        "coordinate_space": "coded source pixels; no autorotation, no sample-aspect-ratio stretch",
    }
    result["frames"] = frames
    if sha256(path) != digest:
        raise EvidenceError(
            "Source changed while it was being probed; retry against an immutable source."
        )
    return result


def _source(value: str | Path | Mapping, *, video: bool = True, pixels: bool = True) -> dict:
    source = dict(value) if isinstance(value, Mapping) else probe(value)
    if source.get("schema") != SCHEMA or source.get("kind") != "source":
        raise EvidenceError("Expected a source path or the result of evidence.probe().")
    if sha256(source["path"]) != source["sha256"]:
        raise EvidenceError(
            "Source hash changed after probing; create new evidence for the new source."
        )
    if video and not source.get("video"):
        raise EvidenceError("This operation requires a video stream.")
    if pixels and (source.get("video") or {}).get("hdr"):
        raise EvidenceError(
            "HDR pixel conversion is not implicit. Create an explicitly tone-mapped derivative and retain its source mapping."
        )
    return source


def _source_summary(source: dict) -> dict:
    return {k: source[k] for k in ("path", "sha256", "bytes", "format", "video", "audio")}


def _span(source: dict, start: int, end: int | None) -> tuple[int, int]:
    size = source["video"]["frame_count"]
    end = size if end is None else end
    if (
        isinstance(start, bool)
        or isinstance(end, bool)
        or not isinstance(start, int)
        or not isinstance(end, int)
        or not 0 <= start < end <= size
    ):
        raise EvidenceError(
            f"Expected 0 <= start < end <= {size}, with integer native frame indices."
        )
    return start, end


def _roi(source: dict, roi: Sequence[int] | None) -> tuple[int, int, int, int]:
    width, height = source["video"]["width"], source["video"]["height"]
    if roi is None:
        return 0, 0, width, height
    if len(roi) != 4 or any(isinstance(v, bool) or not isinstance(v, int) for v in roi):
        raise EvidenceError(
            "ROI must contain four integers: x,y,width,height in coded source pixels."
        )
    x, y, w, h = roi
    if min(x, y) < 0 or min(w, h) <= 0 or x + w > width or y + h > height:
        raise EvidenceError(f"ROI {list(roi)} is outside the {width}x{height} source canvas.")
    return x, y, w, h


def _geometry(source: dict, roi=None, max_width: int | None = None) -> dict:
    x, y, w, h = _roi(source, roi)
    if max_width is not None and (
        isinstance(max_width, bool) or not isinstance(max_width, int) or max_width < 1
    ):
        raise EvidenceError("max_width must be a positive integer or None (native resolution).")
    ow = min(w, max_width) if max_width is not None else w
    oh = max(1, round(h * ow / w))
    return {
        "source_canvas": [source["video"]["width"], source["video"]["height"]],
        "roi": [x, y, w, h],
        "coordinate_origin": [x, y],
        "image_size": [ow, oh],
        "scale_from_source": [ow / w, oh / h],
        "native_resolution": (w, h) == (ow, oh),
        "coordinate_space": source["video"]["coordinate_space"],
    }


def _decode(source: dict, indices: Sequence[int], geometry: dict):
    """Yield selected native frames, with no seeking, rate conversion or rotation."""
    np = _numpy()
    ids = sorted(set(indices))
    if not ids:
        return
    x, y, w, h = geometry["roi"]
    ow, oh = geometry["image_size"]
    # Decode a contiguous window rather than building an unbounded select filter.
    # Crop AFTER RGB conversion so odd source-pixel ROIs are not chroma-aligned.
    filters = [
        f"trim=start_frame={ids[0]}:end_frame={ids[-1] + 1}",
        "format=rgb24",
        f"crop={w}:{h}:{x}:{y}:exact=1",
    ]
    if (ow, oh) != (w, h):
        filters.append(f"scale={ow}:{oh}:flags=area")
    args = [
        "ffmpeg",
        "-v",
        "error",
        "-noautorotate",
        "-i",
        source["path"],
        "-map",
        f"0:{source['video']['stream_index']}",
        "-vf",
        ",".join(filters),
        "-fps_mode",
        "passthrough",
        "-an",
        "-sn",
        "-dn",
        "-pix_fmt",
        "rgb24",
        "-f",
        "rawvideo",
        "pipe:1",
    ]
    wanted = set(ids)
    count = ow * oh * 3
    if not shutil.which("ffmpeg"):
        raise EvidenceError("ffmpeg is required on PATH.")
    with tempfile.TemporaryFile() as error_file:
        process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=error_file)
        try:
            assert process.stdout is not None
            for index in range(ids[0], ids[-1] + 1):
                chunks, remaining = [], count
                while remaining:
                    block = process.stdout.read(remaining)
                    if not block:
                        break
                    chunks.append(block)
                    remaining -= len(block)
                if remaining:
                    raise EvidenceError(
                        f"Decoder ended inside or before native frame {index}; no partial evidence was accepted."
                    )
                if index in wanted:
                    yield index, np.frombuffer(b"".join(chunks), dtype=np.uint8).reshape(oh, ow, 3)
            if process.stdout.read(1):
                raise EvidenceError(
                    "Decoder produced more frames than the native selection; no frame mapping was accepted."
                )
            if process.wait(timeout=30):
                error_file.seek(0)
                raise EvidenceError(
                    f"ffmpeg decode failed: {error_file.read().decode(errors='replace')[-2000:]}"
                )
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
            if process.stdout:
                process.stdout.close()


def _frame_clock(source: dict, index: int) -> dict:
    return {
        k: source["frames"][index][k]
        for k in (
            "index",
            "pts",
            "pts_basis",
            "timestamp",
            "seconds",
            "duration_seconds",
            "duration_basis",
        )
    }


def select_times(
    source: str | Path | Mapping, times: Sequence[float], policy: str = "nearest"
) -> list[dict]:
    """Resolve times relative to the first video PTS; report actual selected PTS."""
    source = _source(source, pixels=False)
    if policy not in ("nearest", "before", "after"):
        raise EvidenceError("Time selection policy must be nearest, before or after.")
    timestamps = [frame["seconds"] for frame in source["frames"]]
    duration = source["video"]["duration"]
    result = []
    for requested in times:
        value = _number(requested)
        if (
            value is None
            or value < 0
            or (duration is not None and value >= duration)
            or (duration is None and value > timestamps[-1])
        ):
            raise EvidenceError(
                f"Requested video-local time {requested!r} is outside the known source interval."
            )
        if policy == "before":
            index = bisect_right(timestamps, value) - 1
        elif policy == "after":
            index = bisect_left(timestamps, value)
        else:
            right = bisect_left(timestamps, value)
            choices = [i for i in (right - 1, right) if 0 <= i < len(timestamps)]
            index = min(choices, key=lambda i: (abs(timestamps[i] - value), i))
        if not 0 <= index < len(timestamps):
            raise EvidenceError(f"No frame {policy} requested video-local time {value}.")
        result.append(
            {
                "requested_seconds": value,
                "policy": policy,
                "selected_index": index,
                "selected_pts": source["frames"][index]["pts"],
                "selected_seconds": timestamps[index],
                "difference_seconds": timestamps[index] - value,
            }
        )
    return result


def frames(
    source: str | Path | Mapping,
    output: str | Path,
    *,
    start: int = 0,
    end: int | None = None,
    indices: Sequence[int] | None = None,
    times: Sequence[float] | None = None,
    policy: str = "nearest",
    step: int = 1,
    roi: Sequence[int] | None = None,
    max_width: int | None = None,
    sheet_columns: int = 0,
) -> dict:
    """Write native selected PNGs plus source/clock/coordinate metadata.

    The default is every native frame in [start,end), without resizing. Explicit
    max_width creates a declared preview. A contact sheet does not replace PNGs.
    """
    source = _source(source)
    if indices is not None and times is not None:
        raise EvidenceError("Use either indices or times, not both.")
    if (indices is not None or times is not None) and (start != 0 or end is not None or step != 1):
        raise EvidenceError(
            "Explicit indices/times cannot be combined with a range or sampling step."
        )
    if not isinstance(step, int) or isinstance(step, bool) or step < 1:
        raise EvidenceError("step must be a positive integer.")
    requests = select_times(source, times, policy) if times is not None else []
    if times is not None:
        selected = [r["selected_index"] for r in requests]
    elif indices is not None:
        selected = list(indices)
    else:
        start, end = _span(source, start, end)
        selected = list(range(start, end, step))
    if not selected or any(
        isinstance(i, bool) or not isinstance(i, int) or not 0 <= i < len(source["frames"])
        for i in selected
    ):
        raise EvidenceError("Selection must contain valid native frame indices.")
    selected = sorted(set(selected))
    geometry = _geometry(source, roi, max_width)
    if not isinstance(sheet_columns, int) or sheet_columns < 0:
        raise EvidenceError("sheet_columns must be a nonnegative integer.")
    Image, ImageDraw = _pillow()
    folder = _new_folder(output)
    items = []
    for index, pixels in _decode(source, selected, geometry):
        path = folder / f"frame-{index:08d}.png"
        Image.fromarray(pixels).save(path)
        items.append(
            {
                **_frame_clock(source, index),
                "path": str(path),
                "sha256": sha256(path),
                "mime_type": "image/png",
                **geometry,
            }
        )
    data = {
        "kind": "frames",
        "source": _source_summary(source),
        "selection": {
            "indices": selected,
            "consecutive_native_frames": all(b == a + 1 for a, b in zip(selected, selected[1:])),
            "time_requests": requests,
        },
        "frames": items,
        "images": [
            {
                "path": item["path"],
                "mime_type": "image/png",
                "width": item["image_size"][0],
                "height": item["image_size"][1],
            }
            for item in items
        ],
        "limitations": [
            "Open or attach these actual images for visual inspection. File creation does not prove Agent viewing or understanding.",
            "PNG pixels are ffmpeg's RGB24 decoding; stored images have no labels painted over the evidence.",
        ],
    }
    if sheet_columns:
        cols = min(sheet_columns, len(items))
        w, h = geometry["image_size"]
        header = 28
        sheet = Image.new("RGB", (cols * w, math.ceil(len(items) / cols) * (h + header)), "#202820")
        draw = ImageDraw.Draw(sheet)
        for slot, item in enumerate(items):
            x, y = (slot % cols) * w, (slot // cols) * (h + header)
            with Image.open(item["path"]) as image:
                sheet.paste(image, (x, y + header))
            draw.text(
                (x + 3, y + 3),
                f"frame {item['index']} | PTS {item['pts']} | {item['seconds']:.6f}s",
                fill="white",
            )
        path = folder / "contact-sheet.png"
        sheet.save(path)
        data["contact_sheet"] = {
            "path": str(path),
            "sha256": sha256(path),
            "image_size": list(sheet.size),
            "columns": cols,
            "tile_size": [w, h],
            "label_height": header,
            "frame_indices": selected,
            "note": "Tile coordinates are not source coordinates. See individual frame geometry.",
        }
    return _save(folder, data)


def _end_timestamp(source: dict, end: int) -> float:
    if end < len(source["frames"]):
        return source["frames"][end]["timestamp"]
    last = source["frames"][-1]
    if last["duration_seconds"] is None:
        raise EvidenceError(
            "Last-frame end is unknown. Choose an earlier end or normalize with explicit timing."
        )
    return last["timestamp"] + last["duration_seconds"]


def clip(
    source: str | Path | Mapping,
    output: str | Path,
    *,
    start: int = 0,
    end: int | None = None,
    roi: Sequence[int] | None = None,
    include_audio: bool = True,
) -> dict:
    """Encode a convenience MP4 with all selected frames and actual PTS spacing.

    The original remains the pixel evidence. Every output frame is probed and
    mapped back to its source frame; VFR is not silently normalized to CFR.
    """
    source = _source(source)
    start, end = _span(source, start, end)
    geometry = _geometry(source, roi)
    first, last = source["frames"][start]["timestamp"], _end_timestamp(source, end)
    folder = _new_folder(output)
    path = folder / "clip.mp4"
    x, y, w, h = geometry["roi"]
    filters = f"trim=start_frame={start}:end_frame={end},setpts=PTS-STARTPTS"
    if roi is not None:
        filters += f",format=rgb24,crop={w}:{h}:{x}:{y}:exact=1"
    args = [
        "ffmpeg",
        "-v",
        "error",
        "-copyts",
        "-noautorotate",
        "-i",
        source["path"],
        "-map",
        f"0:{source['video']['stream_index']}",
        "-vf",
        filters,
        "-fps_mode:v",
        "passthrough",
        "-enc_time_base:v",
        source["video"]["time_base"],
        "-c:v",
        "libx264",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p" if not (w % 2 or h % 2) else "yuv444p",
    ]
    with_audio = include_audio and bool(source["audio"])
    if with_audio:
        args += [
            "-map",
            f"0:{source['audio'][0]['index']}",
            "-af",
            f"atrim=start={first:.12f}:end={last:.12f},asetpts=PTS-({first:.12f})/TB,aresample=async=1:first_pts=0",
            "-c:a",
            "aac",
        ]
    else:
        args += ["-an"]
    _run(args + ["-map_metadata", "-1", "-movflags", "+faststart", str(path)])
    actual = probe(path)
    if actual["video"]["frame_count"] != end - start:
        raise EvidenceError(
            "Clip changed the selected native frame count; output is not accepted as mapped evidence."
        )
    tolerance = max(
        float(Fraction(source["video"]["time_base"])), float(Fraction(actual["video"]["time_base"]))
    )
    mapping = []
    for index, frame in enumerate(actual["frames"]):
        native = source["frames"][start + index]
        expected = native["timestamp"] - first
        error = frame["seconds"] - expected
        if abs(error) > tolerance + 1e-9:
            raise EvidenceError(
                f"Clip PTS changed at source frame {start + index}: {error:.9f}s, beyond one container tick."
            )
        mapping.append(
            {
                "output_index": index,
                "output_pts": frame["pts"],
                "output_seconds": frame["seconds"],
                "source_index": native["index"],
                "source_pts": native["pts"],
                "source_seconds": native["seconds"],
                "timing_error_seconds": error,
            }
        )
    return _save(
        folder,
        {
            "kind": "clip",
            "source": _source_summary(source),
            "span": [start, end],
            **geometry,
            "path": str(path),
            "sha256": actual["sha256"],
            "output": _source_summary(actual),
            "source_start_timestamp": first,
            "source_end_timestamp": last,
            "audio_included": with_audio,
            "frame_mapping": mapping,
            "validation": {
                "frame_count_preserved": True,
                "pts_preserved_within_seconds": tolerance,
            },
            "limitations": [
                "MP4 is a re-encoded viewing derivative, not original pixel evidence.",
                "All selected frame onset PTS are checked. The container/encoder may report a different last-frame duration; output duration is recorded.",
            ],
        },
    )


def audio(
    source: str | Path | Mapping,
    output: str | Path,
    *,
    start: float = 0,
    end: float | None = None,
    sample_rate: int | None = None,
    channels: int | None = None,
) -> dict:
    """Extract a PCM WAV. Times are relative to video origin, or audio origin.

    Audio delay relative to the video is preserved with leading silence. No ASR
    or speech correctness is inferred by extracting this waveform.
    """
    source = _source(source, video=False, pixels=False)
    if not source["audio"]:
        raise EvidenceError("Source has no audio stream.")
    stream = source["audio"][0]
    origin = (
        source["video"]["origin_timestamp"]
        if source["video"]
        else (_number(stream.get("start_time")) or 0)
    )
    duration = source["video"]["duration"] if source["video"] else _number(stream.get("duration"))
    if duration is None:
        duration = source["container_duration"]
    end = duration if end is None else end
    if (
        _number(start) is None
        or start < 0
        or (end is not None and (_number(end) is None or end <= start))
    ):
        raise EvidenceError(
            "Audio requires finite 0 <= start < end (end may be omitted if unknown)."
        )
    if duration is not None and (start >= duration or (end is not None and end > duration + 1e-9)):
        raise EvidenceError("Audio selection exceeds the known source timeline.")
    for label, value in (("sample_rate", sample_rate), ("channels", channels)):
        if value is not None and (
            not isinstance(value, int) or isinstance(value, bool) or value <= 0
        ):
            raise EvidenceError(f"{label} must be a positive integer.")
    folder = _new_folder(output)
    path = folder / "audio.wav"
    absolute = origin + start
    trim = f"atrim=start={absolute:.12f}" + (f":end={origin + end:.12f}" if end is not None else "")
    filters = trim + f",asetpts=PTS-({absolute:.12f})/TB,aresample=async=1:first_pts=0"
    args = [
        "ffmpeg",
        "-v",
        "error",
        "-copyts",
        "-i",
        source["path"],
        "-map",
        f"0:{stream['index']}",
        "-vn",
        "-af",
        filters,
        "-c:a",
        "pcm_s16le",
    ]
    if sample_rate is not None:
        args += ["-ar", str(sample_rate)]
    if channels is not None:
        args += ["-ac", str(channels)]
    _run(args + [str(path)])
    actual = probe(path)
    if not actual["audio"] or (actual["container_duration"] or 0) <= 0:
        raise EvidenceError("Audio selection produced no usable samples.")
    return _save(
        folder,
        {
            "kind": "audio",
            "source": _source_summary(source),
            "path": str(path),
            "sha256": actual["sha256"],
            "output": _source_summary(actual),
            "source_start_timestamp": absolute,
            "source_end_timestamp": origin + end if end is not None else None,
            "source_local_start": start,
            "source_local_end": end,
            "duration": actual["container_duration"],
            "sample_format": "signed 16-bit PCM",
            "limitations": [
                "Extraction and resampling do not establish transcript or word alignment.",
                "The first audio stream is selected explicitly; use a separated source for another track.",
            ],
        },
    )


def loudness(source: str | Path | Mapping, *, windows: Sequence[Sequence[float]]) -> dict:
    """Measure EBU R128 integrated loudness and true peak of each [start, end] window, in seconds.

    Times follow `audio`: relative to the video origin, or the audio origin for audio-only files.
    Windows shorter than 0.4 s or silent have no integrated loudness (null).
    """
    source = _source(source, video=False, pixels=False)
    if not source["audio"]:
        raise EvidenceError("Source has no audio stream.")
    stream = source["audio"][0]
    origin = (
        source["video"]["origin_timestamp"]
        if source["video"]
        else (_number(stream.get("start_time")) or 0)
    )
    if not windows or any(
        len(w) != 2 or _number(w[0]) is None or _number(w[1]) is None or not 0 <= w[0] < w[1]
        for w in windows
    ):
        raise EvidenceError(
            "windows must be a JSON list of [start, end] seconds with 0 <= start < end."
        )
    items = []
    for start, end in windows:
        log = _run(
            [
                "ffmpeg",
                "-hide_banner",
                "-nostats",
                "-i",
                source["path"],
                "-map",
                f"0:{stream['index']}",
                "-vn",
                "-af",
                f"atrim=start={origin + start:.6f}:end={origin + end:.6f},ebur128=peak=true",
                "-f",
                "null",
                "-",
            ],
            stderr=True,
        ).decode(errors="replace")
        integrated = re.findall(r"I:\s+(-?[\d.]+) LUFS", log)
        peak = re.findall(r"Peak:\s+(-?[\d.]+|-inf) dBFS", log)
        value = float(integrated[-1]) if integrated else None
        items.append(
            {
                "start": start,
                "end": end,
                "integrated_lufs": value if value is not None and value > -70 else None,
                "true_peak_dbfs": float(peak[-1]) if peak and peak[-1] != "-inf" else None,
            }
        )
    return {
        "kind": "loudness",
        "source": _source_summary(source),
        "windows": items,
        "limitations": [
            "Measures the mixed track; it does not separate speech from music.",
            "Loudness is not audible quality; listen when the host allows it.",
        ],
    }


def temporal_scan(
    source: str | Path | Mapping,
    output: str | Path,
    *,
    start: int = 0,
    end: int | None = None,
    roi: Sequence[int] | None = None,
    max_width: int | None = 480,
    tiles: int = 4,
    change_threshold: float | None = None,
    flash_threshold: float | None = None,
    hold_threshold: float = 0,
    max_flash_frames: int = 3,
    return_fraction: float = 0.25,
) -> dict:
    """Streaming frame/tile activity and local event candidates, in actual PTS.

    Automatic candidate thresholds are median + 6 MAD for this sampled region.
    They are recorded screening heuristics, never universal quality gates.
    """
    np = _numpy()
    source = _source(source)
    start, end = _span(source, start, end)
    geometry = _geometry(source, roi, max_width)
    if (
        not isinstance(tiles, int)
        or isinstance(tiles, bool)
        or not 1 <= tiles <= min(geometry["image_size"])
    ):
        raise EvidenceError(
            "tiles must be a positive integer no larger than either analysis dimension."
        )
    for label, value in (
        ("change_threshold", change_threshold),
        ("flash_threshold", flash_threshold),
        ("hold_threshold", hold_threshold),
    ):
        if value is not None and (_number(value) is None or value < 0):
            raise EvidenceError(
                f"{label} must be a finite nonnegative value on the 0..255 pixel scale."
            )
    if (
        not isinstance(max_flash_frames, int)
        or isinstance(max_flash_frames, bool)
        or max_flash_frames < 1
        or not 0 <= return_fraction < 1
    ):
        raise EvidenceError(
            "max_flash_frames must be positive and return_fraction must be in [0,1)."
        )
    samples, previous = [], None
    for index, rgb in _decode(source, list(range(start, end)), geometry):
        gray = rgb.astype(np.float32) @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
        row = {
            **_frame_clock(source, index),
            "luma": float(gray.mean()),
            "mean_absolute_delta": None,
            "tile_max_delta": None,
            "strongest_tile": None,
            "delta_seconds": None,
        }
        if previous is not None:
            delta = np.abs(gray - previous)
            blocks = []
            ys, xs = (
                np.linspace(0, gray.shape[0], tiles + 1, dtype=int),
                np.linspace(0, gray.shape[1], tiles + 1, dtype=int),
            )
            for y in range(tiles):
                for x in range(tiles):
                    blocks.append((float(delta[ys[y] : ys[y + 1], xs[x] : xs[x + 1]].mean()), x, y))
            strongest = max(blocks)
            row.update(
                mean_absolute_delta=float(delta.mean()),
                tile_max_delta=strongest[0],
                strongest_tile=[strongest[1], strongest[2]],
                delta_seconds=row["seconds"] - samples[-1]["seconds"],
            )
        samples.append(row)
        previous = gray

    def threshold(values):
        values = np.asarray(values, float)
        if not len(values):
            return 0.0
        median = float(np.median(values))
        return median + 6 * float(np.median(np.abs(values - median)))

    changes = [r["tile_max_delta"] for r in samples[1:]]
    luma_delta = [abs(b["luma"] - a["luma"]) for a, b in zip(samples, samples[1:])]
    cthr = threshold(changes) if change_threshold is None else float(change_threshold)
    fthr = threshold(luma_delta) if flash_threshold is None else float(flash_threshold)
    events: list[dict[str, Any]] = []
    holds: list[dict[str, int]] = []
    active = None
    for row in samples[1:]:
        value = row["tile_max_delta"]
        index = row["index"]
        if value > cthr:
            events.append(
                {
                    "kind": "change_candidate",
                    "index": index,
                    "pts": row["pts"],
                    "seconds": row["seconds"],
                    "strength": value,
                    "evidence_frames": [index - 1, index],
                }
            )
            if active is None:
                active = {
                    "kind": "activity_window_candidate",
                    "onset_index": index,
                    "peak_index": index,
                    "peak": value,
                }
            if value > active["peak"]:
                active.update(peak_index=index, peak=value)
        elif active is not None:
            active["settle_index"] = index
            active["evidence_span"] = [max(start, active["onset_index"] - 1), index + 1]
            events.append(active)
            active = None
        if row["mean_absolute_delta"] <= hold_threshold:
            if holds and holds[-1]["end"] == index:
                holds[-1]["end"] = index + 1
            else:
                holds.append({"start": index - 1, "end": index + 1})
    if active is not None:
        active.update(
            settle_index=None,
            evidence_span=[max(start, active["onset_index"] - 1), end],
            truncated_at_end=True,
        )
        events.append(active)
    for local in range(1, len(samples) - 1):
        base = samples[local - 1]["luma"]
        excursion = samples[local]["luma"] - base
        if abs(excursion) <= fthr:
            continue
        for width in range(1, max_flash_frames + 1):
            after = local + width
            if after < len(samples) and abs(samples[after]["luma"] - base) <= return_fraction * abs(
                excursion
            ):
                row = samples[local]
                events.append(
                    {
                        "kind": "flash_candidate",
                        "index": row["index"],
                        "pts": row["pts"],
                        "seconds": row["seconds"],
                        "luma_excursion": excursion,
                        "width_frames": width,
                        "duration_seconds": samples[after]["seconds"] - row["seconds"],
                        "evidence_span": [row["index"] - 1, samples[after]["index"] + 1],
                    }
                )
                break
    folder = _new_folder(output)
    return _save(
        folder,
        {
            "kind": "temporal-scan",
            "source": _source_summary(source),
            "span": [start, end],
            **geometry,
            "parameters": {
                "tiles": tiles,
                "change_threshold": cthr,
                "change_threshold_origin": "median+6*MAD" if change_threshold is None else "caller",
                "flash_threshold": fthr,
                "flash_threshold_origin": "median+6*MAD" if flash_threshold is None else "caller",
                "hold_threshold": hold_threshold,
                "max_flash_frames": max_flash_frames,
                "return_fraction": return_fraction,
            },
            "samples": samples,
            "events": events,
            "hold_candidates": holds,
            "limitations": [
                "Activity measures image change, not object speed, camera motion or cut identity.",
                "Small movers can be quiet globally. Inspect the strongest tile or request a source-resolution ROI.",
                "Flash/hold/onset candidates require inspection of their native evidence windows; no automatic story or fidelity verdict.",
            ],
        },
    )


def track(
    source: str | Path | Mapping,
    output: str | Path,
    *,
    anchors: Mapping[int, Sequence[int]],
    min_score: float,
    search_radius: int,
    start: int = 0,
    end: int | None = None,
    min_peak_margin: float = 0,
    cut_frames: Sequence[int] = (),
) -> dict:
    """Track an explicit, fixed-size template by local NCC in source pixels.

    A rejected match ends that track segment. Reacquisition requires another
    explicit anchor; missing observations remain null, including after cuts.
    min_score and search_radius are caller choices, not quality constants.
    """
    np, cv2 = _numpy(), _opencv()
    source = _source(source)
    start, end = _span(source, start, end)
    if not anchors:
        raise EvidenceError("At least one native-frame anchor ROI is required.")
    normalized = {}
    for index, box in anchors.items():
        if isinstance(index, str) and index.isdigit():
            index = int(index)
        if isinstance(index, bool) or not isinstance(index, int) or not start <= index < end:
            raise EvidenceError("Anchor indices must lie inside the selected frame range.")
        normalized[index] = _roi(source, box)
    if (
        not math.isfinite(min_score)
        or not -1 <= min_score <= 1
        or not math.isfinite(min_peak_margin)
        or not 0 <= min_peak_margin <= 2
    ):
        raise EvidenceError("NCC min_score must be in [-1,1] and peak margin in [0,2].")
    if not isinstance(search_radius, int) or isinstance(search_radius, bool) or search_radius < 0:
        raise EvidenceError("search_radius must be a nonnegative number of source pixels.")
    cuts = set(cut_frames)
    if any(not isinstance(i, int) or isinstance(i, bool) or not start <= i < end for i in cuts):
        raise EvidenceError("Cut frames must lie within the selected frame range.")
    geometry = _geometry(source)
    template, previous_box, previous_valid, segment = None, None, None, None
    rows = []
    for index, rgb in _decode(source, list(range(start, end)), geometry):
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        row = {
            **_frame_clock(source, index),
            "status": "missing",
            "box": None,
            "center": None,
            "velocity_px_per_second": None,
            "segment_anchor": segment,
            "score": None,
            "peak_margin": None,
        }
        if index in cuts:
            template = previous_box = previous_valid = None
        if index in normalized:
            x, y, w, h = normalized[index]
            template = gray[y : y + h, x : x + w].copy()
            if float(template.std()) == 0:
                raise EvidenceError(
                    f"Anchor at frame {index} is textureless; NCC cannot identify its position. Include an edge or another feature."
                )
            previous_box = [x, y, w, h]
            segment = index
            row.update(
                status="anchor",
                box=previous_box[:],
                center=[x + w / 2, y + h / 2],
                segment_anchor=segment,
                reason="caller_supplied_anchor",
            )
        elif template is None:
            row["reason"] = (
                "cut_requires_anchor" if index in cuts else "no_active_track_requires_anchor"
            )
        else:
            assert previous_box is not None
            x, y, w, h = previous_box
            left, top = max(0, x - search_radius), max(0, y - search_radius)
            right, bottom = (
                min(gray.shape[1], x + w + search_radius),
                min(gray.shape[0], y + h + search_radius),
            )
            scores = cv2.matchTemplate(gray[top:bottom, left:right], template, cv2.TM_CCOEFF_NORMED)
            _, best, _, location = cv2.minMaxLoc(scores)
            bx, by = location
            # Runner-up peak excludes the same object's broad correlation lobe.
            alternate = scores.copy()
            dx, dy = max(1, w // 2), max(1, h // 2)
            alternate[max(0, by - dy) : by + dy + 1, max(0, bx - dx) : bx + dx + 1] = -np.inf
            second = float(alternate.max())
            margin = best - second if math.isfinite(second) else None
            row.update(score=float(best), peak_margin=margin)
            if (
                not math.isfinite(best)
                or best < min_score
                or (margin is not None and margin < min_peak_margin)
            ):
                row.update(
                    reason="low_score" if best < min_score else "ambiguous_peak",
                    diagnostic_candidate_box=[left + bx, top + by, w, h],
                )
                template = previous_box = previous_valid = None
            else:
                previous_box = [left + bx, top + by, w, h]
                row.update(
                    status="observed",
                    box=previous_box[:],
                    center=[left + bx + w / 2, top + by + h / 2],
                )
        if row["box"] is not None:
            if (
                previous_valid is not None
                and previous_valid["index"] + 1 == index
                and previous_valid["segment_anchor"] == row["segment_anchor"]
            ):
                dt = row["seconds"] - previous_valid["seconds"]
                row["velocity_px_per_second"] = [
                    (a - b) / dt for a, b in zip(row["center"], previous_valid["center"])
                ]
            previous_valid = row
        rows.append(row)
    folder = _new_folder(output)
    return _save(
        folder,
        {
            "kind": "track",
            "source": _source_summary(source),
            "span": [start, end],
            **geometry,
            "parameters": {
                "anchors": normalized,
                "min_score": min_score,
                "search_radius": search_radius,
                "min_peak_margin": min_peak_margin,
                "cut_frames": sorted(cuts),
                "method": "fixed-template local normalized cross-correlation",
                "opencv_version": cv2.__version__,
            },
            "samples": rows,
            "limitations": [
                "Translation-only template matching cannot measure scale, perspective, deformation or hidden object identity.",
                "Similar objects may remain ambiguous even at high NCC; inspect actual frames and provide explicit anchors.",
                "Missing observations are not interpolated. No reacquisition occurs after loss/cut until an explicit anchor.",
            ],
        },
    )


def fit_plane(
    source_points: Sequence,
    target_points: Sequence,
    *,
    held_out: Sequence[int],
    model: str = "projective",
    tolerance: float,
    material_quad: Sequence | None = None,
) -> dict:
    """Fit an explicit 2D transform; withhold validation points before RANSAC.

    The caller supplies correspondence identity and pixel tolerance. A fitted
    projective map does not establish a 3D camera or certify unseen corners.
    """
    np, cv2 = _numpy(), _opencv()
    source, target = np.asarray(source_points, float), np.asarray(target_points, float)
    if (
        source.ndim != 2
        or source.shape[1:] != (2,)
        or target.shape != source.shape
        or not np.isfinite([source, target]).all()
    ):
        raise EvidenceError("Source and target points must be equal finite Nx2 arrays.")
    if (
        model not in ("similarity", "affine", "projective")
        or not math.isfinite(tolerance)
        or tolerance <= 0
    ):
        raise EvidenceError("Choose similarity/affine/projective and a positive pixel tolerance.")
    validation = list(held_out)
    if (
        not validation
        or len(set(validation)) != len(validation)
        or any(
            not isinstance(i, int) or isinstance(i, bool) or not 0 <= i < len(source)
            for i in validation
        )
    ):
        raise EvidenceError(
            "held_out must contain distinct valid indices, selected before fitting."
        )
    train = [i for i in range(len(source)) if i not in validation]
    minimum = {"similarity": 2, "affine": 3, "projective": 4}[model]
    if len(train) < minimum:
        raise EvidenceError(
            f"{model} requires at least {minimum} training correspondences in addition to held-out points."
        )
    s, t = source[train], target[train]
    if len(np.unique(source, axis=0)) != len(source) or len(np.unique(target, axis=0)) != len(
        target
    ):
        raise EvidenceError(
            "All correspondence endpoints must be distinct, including held-out landmarks."
        )
    if model != "similarity" and (
        np.linalg.matrix_rank(s - s.mean(0)) < 2 or np.linalg.matrix_rank(t - t.mean(0)) < 2
    ):
        raise EvidenceError("Collinear correspondences cannot establish a plane transform.")
    cv2.setRNGSeed(1709)
    if model == "projective":
        matrix, inliers = cv2.findHomography(
            s, t, cv2.RANSAC, tolerance, maxIters=3000, confidence=0.995
        )
    else:
        method = cv2.estimateAffinePartial2D if model == "similarity" else cv2.estimateAffine2D
        matrix, inliers = method(
            s,
            t,
            method=cv2.RANSAC,
            ransacReprojThreshold=tolerance,
            maxIters=3000,
            confidence=0.995,
        )
        if matrix is not None:
            matrix = np.vstack([matrix, [0, 0, 1]])
    if matrix is None or not np.isfinite(matrix).all() or abs(np.linalg.det(matrix)) < 1e-12:
        return {
            "kind": "plane",
            "status": "no_valid_fit",
            "model": model,
            "train_indices": train,
            "held_out_indices": validation,
        }

    def project(points):
        homogeneous = np.column_stack([points, np.ones(len(points))]) @ matrix.T
        if np.any(np.abs(homogeneous[:, 2]) < 1e-12):
            raise EvidenceError("Transform crosses infinity at a supplied point.")
        return homogeneous[:, :2] / homogeneous[:, 2:]

    errors = np.linalg.norm(project(source[validation]) - target[validation], axis=1)
    result = {
        "kind": "plane",
        "status": "fitted",
        "model": model,
        "matrix": matrix.tolist(),
        "tolerance_px": tolerance,
        "train_indices": train,
        "held_out_indices": validation,
        "train_inlier_indices": [index for index, good in zip(train, inliers.ravel()) if good],
        "validation_errors_px": errors.tolist(),
        "validation_max_px": float(errors.max()),
        "held_out_within_requested_tolerance": bool((errors <= tolerance).all()),
        "source_points": source.tolist(),
        "target_points": target.tolist(),
        "opencv_version": cv2.__version__,
        "limitations": [
            "Held-out points were excluded before RANSAC; they validate these correspondences only.",
            "A 2D transform is not a 3D camera solution. Sparse/local point support does not establish unobserved corners or the original authoring mechanism.",
        ],
    }
    hull = cv2.convexHull(s.astype(np.float32))
    result["training_source_hull"] = hull.reshape(-1, 2).tolist()
    if material_quad is not None:
        quad = np.asarray(material_quad, float)
        if (
            quad.shape != (4, 2)
            or not np.isfinite(quad).all()
            or not cv2.isContourConvex(quad.astype(np.float32))
        ):
            raise EvidenceError("material_quad must be four ordered finite convex corners.")
        denominators = np.column_stack([quad, np.ones(4)]) @ matrix[2]
        if denominators.min() * denominators.max() <= 0:
            raise EvidenceError("Transform crosses infinity inside the supplied material quad.")
        result["projected_quad"] = project(quad).tolist()
        area = abs(cv2.contourArea(quad.astype(np.float32)))
        result["training_hull_area_over_material_area"] = (
            abs(cv2.contourArea(hull)) / area if area else None
        )
        result["full_plane_supported"] = None
    return result


def _feature_mask(size, visible_path, excluded_path, initial=None):
    np = _numpy()
    Image, _ = _pillow()
    mask = np.ones((size[1], size[0]), dtype=bool) if initial is None else initial.copy()
    inputs = []
    for role, value in (("visible", visible_path), ("excluded", excluded_path)):
        if value is None:
            continue
        path = Path(value).expanduser().resolve()
        digest = sha256(path)
        with Image.open(path) as image:
            if image.size != tuple(size) or image.mode not in ("1", "L"):
                raise EvidenceError(
                    f"{role} mask must be a binary/grayscale image of the original {size[0]}x{size[1]} canvas: {path}"
                )
            selected = np.asarray(image.convert("L")) > 0
        mask &= selected if role == "visible" else ~selected
        inputs.append({"role": role, "path": str(path), "sha256": digest})
    return mask.astype(np.uint8) * 255, inputs


def _sift_matches(
    asset_pixels, frame_pixels, asset_mask, frame_mask, *, ratio, max_features, contrast_threshold
):
    np, cv2 = _numpy(), _opencv()
    sift = cv2.SIFT_create(nfeatures=max_features, contrastThreshold=contrast_threshold)

    def features(pixels, mask):
        gray = cv2.cvtColor(pixels, cv2.COLOR_RGB2GRAY)
        keys, descriptors = sift.detectAndCompute(gray, mask)
        rows = [
            {"point": list(key.pt), "size": key.size, "angle": key.angle, "response": key.response}
            for key in keys
        ]
        return rows, descriptors

    asset_features, ad = features(asset_pixels, asset_mask)
    frame_features, fd = features(frame_pixels, frame_mask)
    matches: list[dict] = []
    if ad is None or fd is None or min(len(ad), len(fd)) < 2:
        return asset_features, frame_features, matches
    matcher = cv2.BFMatcher(cv2.NORM_L2)
    reverse = {}
    for pair in matcher.knnMatch(fd, ad, k=2):
        if len(pair) == 2 and pair[0].distance < ratio * pair[1].distance:
            reverse[pair[0].queryIdx] = pair[0].trainIdx
    for pair in matcher.knnMatch(ad, fd, k=2):
        if len(pair) != 2:
            continue
        first, second = pair
        reason = (
            "ratio_rejected"
            if not first.distance < ratio * second.distance
            else "not_mutual"
            if reverse.get(first.trainIdx) != first.queryIdx
            else "accepted"
        )
        matches.append(
            {
                "asset_feature": first.queryIdx,
                "frame_feature": first.trainIdx,
                "distance": first.distance,
                "second_distance": second.distance,
                "ratio": first.distance / second.distance if second.distance else None,
                "status": reason,
            }
        )
    # SIFT can report several orientations at the same location. Do not let the
    # same landmark enter both training and validation under different IDs.
    kept_asset: list = []
    kept_frame: list = []
    for row in sorted(matches, key=lambda row: row["distance"]):
        if row["status"] != "accepted":
            continue
        a = np.asarray(asset_features[row["asset_feature"]]["point"])
        f = np.asarray(frame_features[row["frame_feature"]]["point"])
        if any(np.linalg.norm(a - p) < 1 for p in kept_asset) or any(
            np.linalg.norm(f - p) < 1 for p in kept_frame
        ):
            row["status"] = "duplicate_endpoint"
        else:
            kept_asset.append(a)
            kept_frame.append(f)
    return asset_features, frame_features, matches


def correspondences(
    asset: str | Path,
    source: str | Path | Mapping,
    output: str | Path,
    *,
    index: int,
    tolerance: float,
    roi: Sequence[int] | None = None,
    asset_visible_mask: str | Path | None = None,
    asset_exclude_mask: str | Path | None = None,
    frame_visible_mask: str | Path | None = None,
    frame_exclude_mask: str | Path | None = None,
    ratio: float = 0.72,
    holdout_fraction: float = 0.25,
    seed: int = 1709,
    model: str = "projective",
    max_features: int = 6000,
    contrast_threshold: float = 0.018,
) -> dict:
    """Match an asset to one native frame, withholding landmarks before fitting."""
    np, cv2 = _numpy(), _opencv()
    Image, ImageDraw = _pillow()
    if not 0 < ratio < 1 or not 0 < holdout_fraction < 1:
        raise EvidenceError("ratio and holdout_fraction must be strictly between zero and one.")
    if (
        model not in ("similarity", "affine", "projective")
        or not math.isfinite(tolerance)
        or tolerance <= 0
    ):
        raise EvidenceError("Choose similarity/affine/projective and a positive pixel tolerance.")
    if not isinstance(max_features, int) or isinstance(max_features, bool) or max_features < 1:
        raise EvidenceError("max_features must be a positive integer.")
    if not math.isfinite(contrast_threshold) or contrast_threshold <= 0:
        raise EvidenceError("contrast_threshold must be positive.")
    if not isinstance(seed, int) or isinstance(seed, bool) or seed < 0:
        raise EvidenceError("seed must be a nonnegative integer.")
    source = _source(source)
    _span(source, index, index + 1)
    geometry = _geometry(source, roi)
    asset_path = Path(asset).expanduser().resolve()
    asset_hash = sha256(asset_path)
    with Image.open(asset_path) as image:
        if getattr(image, "n_frames", 1) != 1:
            raise EvidenceError("Choose one still asset image, not an animated image.")
        asset_size = image.size
        alpha = np.asarray(image.convert("RGBA"))[:, :, 3]
        asset_pixels = np.asarray(image.convert("RGB"))
    asset_mask, asset_masks = _feature_mask(
        asset_size, asset_visible_mask, asset_exclude_mask, alpha == 255
    )
    frame_mask, frame_masks = _feature_mask(
        geometry["source_canvas"], frame_visible_mask, frame_exclude_mask
    )
    x, y, w, h = geometry["roi"]
    frame_mask = frame_mask[y : y + h, x : x + w]
    folder = _new_folder(output)
    extracted = frames(source, folder / "frame", indices=[index], roi=roi)
    frame = extracted["frames"][0]
    with Image.open(frame["path"]) as image:
        frame_pixels = np.asarray(image.convert("RGB"))
    asset_features, frame_features, matches = _sift_matches(
        asset_pixels,
        frame_pixels,
        asset_mask,
        frame_mask,
        ratio=ratio,
        max_features=max_features,
        contrast_threshold=contrast_threshold,
    )
    for row in frame_features:
        row["point"] = [row["point"][0] + x, row["point"][1] + y]
    accepted = [row for row in matches if row["status"] == "accepted"]
    points = [asset_features[row["asset_feature"]]["point"] for row in accepted]
    targets = [frame_features[row["frame_feature"]]["point"] for row in accepted]
    minimum = {"similarity": 2, "affine": 3, "projective": 4}[model]
    validation = []
    fit: dict = {"status": "insufficient_matches", "minimum_with_holdout": minimum + 1}
    quad = [
        [0, 0],
        [asset_size[0] - 1, 0],
        [asset_size[0] - 1, asset_size[1] - 1],
        [0, asset_size[1] - 1],
    ]
    if len(accepted) > minimum:
        count = min(len(accepted) - minimum, max(1, math.ceil(len(accepted) * holdout_fraction)))
        validation = sorted(
            int(v) for v in np.random.default_rng(seed).choice(len(accepted), count, replace=False)
        )
        try:
            fit = fit_plane(
                points,
                targets,
                held_out=validation,
                model=model,
                tolerance=tolerance,
                material_quad=quad,
            )
        except EvidenceError as exc:
            fit = {"status": "no_valid_fit", "reason": str(exc)}
    inliers = set(fit.get("train_inlier_indices", []))
    for i, row in enumerate(accepted):
        row.update(correspondence_index=i, split="held_out" if i in validation else "train")
        row["train_inlier"] = (
            i in inliers if fit["status"] == "fitted" and i not in validation else None
        )
    evidence_files = [
        {"path": "frame/manifest.json", "sha256": sha256(extracted["manifest_path"])},
        {"path": str(Path(frame["path"]).relative_to(folder)), "sha256": frame["sha256"]},
    ]
    for name, pixels in (
        ("asset.png", asset_pixels),
        ("asset-mask.png", asset_mask),
        ("frame-mask.png", frame_mask),
    ):
        path = folder / name
        Image.fromarray(pixels).save(path)
        evidence_files.append({"path": name, "sha256": sha256(path)})
    asset_fact = {
        "path": str(asset_path),
        "sha256": asset_hash,
        "image_size": list(asset_size),
        "coordinate_space": "original decoded asset pixels; no EXIF rotation",
        "alpha_policy": "only fully opaque keypoint centers",
    }
    document = {
        "source_points": points,
        "target_points": targets,
        "held_out": validation,
        "model": model,
        "tolerance_px": tolerance,
        "material_quad": quad,
        "asset": asset_fact,
        "source": _source_summary(source),
        "frame": frame,
        "evidence_files": evidence_files,
    }
    _dump(folder / "correspondences.json", document)
    # Labels and match marks are separate from original evidence pixels.
    sheet = Image.new("RGB", (asset_size[0] + w, max(asset_size[1], h) + 28), "#17201f")
    sheet.paste(Image.fromarray(asset_pixels), (0, 28))
    sheet.paste(Image.fromarray(frame_pixels), (asset_size[0], 28))
    draw = ImageDraw.Draw(sheet)
    draw.text((4, 6), "ASSET | green=train inlier; red=train outlier; amber=held out", fill="white")
    draw.text(
        (asset_size[0] + 4, 6),
        f"NATIVE FRAME {index} | PTS {frame['pts']} | ROI {x},{y}",
        fill="white",
    )
    for i, (a, f) in enumerate(zip(points, targets)):
        color = "#ffc857" if i in validation else "#4de19c" if i in inliers else "#ff5470"
        a = (a[0], a[1] + 28)
        f = (f[0] - x + asset_size[0], f[1] - y + 28)
        draw.line([a, f], fill=color, width=1)
        for px, py in (a, f):
            draw.ellipse((px - 2, py - 2, px + 2, py + 2), outline=color)
    overlay = folder / "matches.png"
    sheet.save(overlay)
    for fact in [asset_fact, *asset_masks, *frame_masks]:
        if sha256(fact["path"]) != fact["sha256"]:
            raise EvidenceError(f"Matching input changed during extraction: {fact['path']}")
    return _save(
        folder,
        {
            "kind": "correspondences",
            "status": fit["status"],
            "source": _source_summary(source),
            "asset": asset_fact,
            "frame": frame,
            "masks": {
                "asset_inputs": asset_masks,
                "frame_inputs": frame_masks,
                "asset_effective": "asset-mask.png",
                "frame_effective": "frame-mask.png",
                "rule": "visible > 0 AND NOT excluded > 0; frame masks supplied at full coded source size before ROI",
            },
            "parameters": {
                "method": "SIFT, bidirectional two-neighbor ratio, unique spatial endpoints",
                "ratio": ratio,
                "max_features": max_features,
                "contrast_threshold": contrast_threshold,
                "deduplicate_endpoint_distance_px": 1,
                "model": model,
                "tolerance_px": tolerance,
                "holdout_fraction": holdout_fraction,
                "seed": seed,
                "opencv_version": cv2.__version__,
            },
            "features": {"asset": asset_features, "frame": frame_features},
            "matches": matches,
            "accepted_count": len(accepted),
            "fit": fit,
            "correspondences": {
                "path": str(folder / "correspondences.json"),
                "sha256": sha256(folder / "correspondences.json"),
                "fit_ready": len(accepted) > minimum,
            },
            "images": [
                *extracted["images"],
                {
                    "path": str(folder / "asset.png"),
                    "mime_type": "image/png",
                    "width": asset_size[0],
                    "height": asset_size[1],
                },
                {
                    "path": str(overlay),
                    "mime_type": "image/png",
                    "width": sheet.width,
                    "height": sheet.height,
                },
            ],
            "limitations": [
                "Automatic matches remain hypotheses. Repeated UI and text can agree on an incorrect instance; inspect actual pixels and independent landmarks.",
                "Masks constrain feature centers; SIFT descriptor neighborhoods can extend across mask boundaries. Hidden regions have no observed correspondences.",
                "Holdout is selected before geometric fitting; no geometric residual filtering is applied to held-out matches. Match uncertainty can therefore fail validation.",
                "A 2D fit is not original 3D camera recovery. Full-plane support remains unknown even if local held-out points pass.",
                "No interpolation or recovery is invented for an insufficient/failed frame. Blur, exposure, nonplanarity, low texture and extreme perspective can prevent matching.",
            ],
        },
    )


def plane(input_path: str | Path, output: str | Path) -> dict:
    """Fit a JSON correspondence document and retain its hash as evidence."""
    path = Path(input_path).expanduser().resolve()
    raw = path.read_bytes()
    document_digest = hashlib.sha256(raw).hexdigest()
    document = json.loads(raw)
    result = fit_plane(
        document["source_points"],
        document["target_points"],
        held_out=document["held_out"],
        model=document.get("model", "projective"),
        tolerance=document["tolerance_px"],
        material_quad=document.get("material_quad"),
    )
    inputs = []
    for item in document.get("evidence_files", []):
        evidence = (path.parent / item["path"]).resolve()
        evidence_digest = sha256(evidence)
        if item.get("sha256") and item["sha256"] != evidence_digest:
            raise EvidenceError(f"Plane correspondence evidence changed: {evidence}")
        inputs.append({"path": str(evidence), "sha256": evidence_digest})
    folder = _new_folder(output)
    if sha256(path) != document_digest:
        raise EvidenceError(
            "Correspondence document changed during fitting; create evidence from a frozen input."
        )
    return _save(
        folder,
        {
            **result,
            "input": {"path": str(path), "sha256": document_digest},
            "evidence_files": inputs,
        },
    )


def compare(
    reference: str | Path | Mapping,
    candidate: str | Path | Mapping,
    output: str | Path,
    *,
    pairs: Sequence[Sequence[int]],
    roi: Sequence[int] | None = None,
    regions: Mapping[str, Any] | None = None,
) -> dict:
    """Write explicit native frame pairs and pixel differences; no auto alignment.

    Named ``regions`` ([x,y,w,h] in coded source pixels, inside ``roi`` when one
    is given) add per-layer sharpness, color and ink-box measurements, because a
    whole-frame score averages a blurred or resized layer away.
    """
    np = _numpy()
    Image, ImageDraw = _pillow()
    reference, candidate = _source(reference), _source(candidate)
    if not pairs or any(
        len(p) != 2
        or any(not isinstance(i, int) or isinstance(i, bool) for i in p)
        or not 0 <= p[0] < len(reference["frames"])
        or not 0 <= p[1] < len(candidate["frames"])
        for p in pairs
    ):
        raise EvidenceError(
            "pairs must explicitly map valid [reference_index,candidate_index] native frames."
        )
    left_geometry, right_geometry = _geometry(reference, roi), _geometry(candidate, roi)
    if left_geometry["image_size"] != right_geometry["image_size"]:
        raise EvidenceError(
            "Comparison pixel dimensions differ. Supply a common valid ROI or an explicit transformed derivative."
        )
    local_regions = _local_regions(left_geometry, regions or {})
    folder = _new_folder(output)
    # Extract each side as its own inspectable evidence; read pairs one at a time.
    left = frames(reference, folder / "reference", indices=sorted({p[0] for p in pairs}), roi=roi)
    right = frames(candidate, folder / "candidate", indices=sorted({p[1] for p in pairs}), roi=roi)
    left_lookup, right_lookup = (
        {r["index"]: r for r in left["frames"]},
        {r["index"]: r for r in right["frames"]},
    )
    items = []
    w, h = left_geometry["image_size"]
    for number, (a, b) in enumerate(pairs):
        with Image.open(left_lookup[a]["path"]) as im:
            left_image = im.convert("RGB")
        with Image.open(right_lookup[b]["path"]) as im:
            right_image = im.convert("RGB")
        delta = np.abs(np.asarray(left_image).astype(float) - np.asarray(right_image).astype(float))
        rmse = float(np.sqrt(np.mean(delta**2)))
        sheet = Image.new("RGB", (2 * w, h + 28), "#202820")
        sheet.paste(left_image, (0, 28))
        sheet.paste(right_image, (w, 28))
        ImageDraw.Draw(sheet).text((4, 4), f"REF frame {a} / CANDIDATE frame {b}", fill="white")
        path, diff = folder / f"pair-{number:06d}.png", folder / f"difference-{number:06d}.png"
        sheet.save(path)
        Image.fromarray(delta.astype(np.uint8)).save(diff)
        items.append(
            {
                "reference": _frame_clock(reference, a),
                "candidate": _frame_clock(candidate, b),
                "path": str(path),
                "sha256": sha256(path),
                "difference_path": str(diff),
                "difference_sha256": sha256(diff),
                "mae_rgb_255": float(delta.mean()),
                "rmse_rgb_255": rmse,
                "psnr_db": 20 * math.log10(255 / rmse) if rmse > 0 else None,
                "pixels_identical": rmse == 0,
                "regions": {
                    name: _region_metrics(
                        np.asarray(left_image), np.asarray(right_image), box, origin, ink
                    )
                    for name, (box, origin, ink) in local_regions.items()
                },
            }
        )
    return _save(
        folder,
        {
            "kind": "compare",
            "reference": _source_summary(reference),
            "candidate": _source_summary(candidate),
            "reference_geometry": left_geometry,
            "candidate_geometry": right_geometry,
            "label_height": 28,
            "tile_size": [w, h],
            "pairs": items,
            "limitations": [
                "Correspondence is caller supplied. Metrics do not prove temporal alignment or creative equivalence.",
                "RGB24 pixel error is descriptive, not a perceptual or story-quality score; style-only remixes need their own acceptance criteria.",
                "Whole-frame metrics average local blur, size and color errors away; measure layers with tight named regions.",
                "highpass_std is the luma std of image minus its 5x5 box blur. It also scales with contrast and texture, so compare like content; highpass_to_contrast divides by the region's luma std.",
                "Ink is Otsu-thresholded luma. Its polarity is the region's given ink (dark or light), else the reference's minority side, and is reused for the candidate. Bold text filling over half of a tight region needs an explicit ink; specks inside the region extend the box.",
            ],
        },
    )


# continuity: every candidate frame against the source frame at the same time (0..255 luma).
CONTINUITY_WIDTH = 160  # analysis width in pixels
CONTINUITY_NEIGHBOURS = 2  # a candidate spike must beat the source's max within +-this many frames
STATIC_WINDOW = 12  # static mask: source per-pixel change stays low for +-this many frames ...
STATIC_LEVEL = 6.0  # ... below this level
STATIC_MIN_SHARE = 0.05  # fewer static pixels than this share: no static curve at that frame
JUMP_ABS, JUMP_RATIO = 3.0, 2.0  # whole-frame change over the source's max by both margins
FLICKER_ABS, FLICKER_RATIO = 2.0, 3.0  # static-region change over the source's max by both
FLICKER_LOCAL = 1.8  # ... and over the candidate's own static median within +-STATIC_WINDOW
STRUCTURE_K = 4.0  # structure spike: above the film's median + k * MAD ...
STRUCTURE_LOCAL = 1.5  # ... above this multiple of its median within +-1 s ...
STRUCTURE_MIN = 1.5  # ... and above this floor (mean-normalised edge difference)
STRUCTURE_BOX = 0.15  # local window for the structure difference, share of the width
EVENT_GAP = 2  # flagged frames this close merge into one event


def _edges(gray):
    cv2 = _opencv()
    blurred = cv2.GaussianBlur(gray, (0, 0), 1.0)
    magnitude = cv2.magnitude(
        cv2.Sobel(blurred, cv2.CV_32F, 1, 0), cv2.Sobel(blurred, cv2.CV_32F, 0, 1)
    )
    return cv2.GaussianBlur(magnitude, (0, 0), 2.0)


def _gray_frames(source: dict, indices: Sequence[int], max_width: int, size=None):
    """Decode native frames to small uint8 luma, optionally resized to (width, height)."""
    np, cv2 = _numpy(), _opencv()
    result = {}
    for index, rgb in _decode(source, indices, _geometry(source, None, max_width)):
        gray = cv2.cvtColor(np.ascontiguousarray(rgb), cv2.COLOR_RGB2GRAY)
        if size and gray.shape[::-1] != tuple(size):
            gray = cv2.resize(gray, tuple(size), interpolation=cv2.INTER_AREA)
        result[index] = gray
    return result


def continuity(
    source: str | Path | Mapping,
    candidate: str | Path | Mapping,
    output: str | Path,
    *,
    start: float = 0,
    end: float | None = None,
    max_width: int = CONTINUITY_WIDTH,
) -> dict:
    """Find jumps, background flicker and extra/missing structure the source does not have.

    Each candidate frame is paired with the source frame nearest its timestamp, so both
    films must share the composition clock. Writes continuity.json and one sheet per event.
    """
    np, cv2 = _numpy(), _opencv()
    Image, ImageDraw = _pillow()
    src, cand = _source(source), _source(candidate)
    times = [f["seconds"] for f in src["frames"]]
    step = _frame_seconds(src)
    picked = _frame_window(cand, start, end)
    pairs = []
    for index in picked:
        t = cand["frames"][index]["seconds"]
        after = bisect_left(times, t)
        j = min(
            (k for k in (after - 1, after) if 0 <= k < len(times)), key=lambda k: abs(times[k] - t)
        )
        if abs(times[j] - t) <= step:
            pairs.append((index, j))
    if len(pairs) < 3:
        raise EvidenceError(
            "Fewer than three candidate frames have a source frame at the same time."
        )
    cand_gray = _gray_frames(cand, [i for i, _ in pairs], max_width)
    size = next(iter(cand_gray.values())).shape[::-1]
    low = max(0, pairs[0][1] - STATIC_WINDOW - 1)
    high = min(len(times), pairs[-1][1] + STATIC_WINDOW + 1)
    src_gray = _gray_frames(src, range(low, high), max_width, size)
    stack = np.stack([src_gray[k] for k in range(low, high)])
    del src_gray
    moved = np.zeros_like(stack)
    moved[1:] = cv2.absdiff(
        stack[1:].reshape(len(stack) - 1, -1), stack[:-1].reshape(len(stack) - 1, -1)
    ).reshape(stack[1:].shape)
    # Per-pixel max change over +-STATIC_WINDOW frames: a dilation along the time axis.
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 2 * STATIC_WINDOW + 1))
    busiest = cv2.dilate(moved.reshape(len(stack), -1), kernel).reshape(stack.shape)
    rows, previous = [], None
    box = max(3, round(STRUCTURE_BOX * size[0]))
    scale = src["video"]["width"] / size[0]
    for i, j in pairs:
        current = cand_gray[i].astype(np.float32)
        k = j - low
        mask = busiest[k] < STATIC_LEVEL
        a, b = _edges(stack[k].astype(np.float32)), _edges(current)
        difference = cv2.blur(np.abs(a - b) / ((a.mean() + b.mean()) / 2 + 1e-6), (box, box))
        y, x = np.unravel_index(int(difference.argmax()), difference.shape)
        row: dict[str, Any] = {
            "index": i,
            "seconds": cand["frames"][i]["seconds"],
            "source_index": j,
            "source_change": float(moved[k].mean()) if j > 0 else None,
            "change": None,
            "static_share": float(mask.mean()),
            "source_static_change": None,
            "static_change": None,
            "structure": float(difference.max()),
            "structure_at": [round(x * scale), round(y * scale)],
        }
        if previous is not None and j > 0:
            delta = np.abs(current - previous)
            row["change"] = float(delta.mean())
            if mask.mean() >= STATIC_MIN_SHARE:
                row["source_static_change"] = float(moved[k][mask].mean())
                row["static_change"] = float(delta[mask].mean())
        rows.append(row)
        previous = current
    del stack, moved, busiest

    def around(key: str, n: int, reach: int, reduce) -> float | None:
        values = [r[key] for r in rows[max(0, n - reach) : n + reach + 1] if r[key] is not None]
        return float(reduce(values)) if values else None

    structure = np.array([r["structure"] for r in rows])
    median = float(np.median(structure))
    mad = max(float(np.median(np.abs(structure - median))), 0.05 * median)
    structure_threshold = max(STRUCTURE_MIN, median + STRUCTURE_K * mad)
    local_reach = max(1, round(1.0 / _frame_seconds(cand)))
    flagged: list[tuple[int, str, float, float | None]] = []
    for n, r in enumerate(rows):
        if r["change"] is not None:
            reference = around("source_change", n, CONTINUITY_NEIGHBOURS, max) or 0.0
            if r["change"] > max(reference + JUMP_ABS, reference * JUMP_RATIO):
                flagged.append((n, "jump", r["change"], reference))
            elif r["static_change"] is not None:
                reference = around("source_static_change", n, CONTINUITY_NEIGHBOURS, max) or 0.0
                own = around("static_change", n, STATIC_WINDOW, np.median) or 0.0
                if r["static_change"] > max(
                    reference + FLICKER_ABS, reference * FLICKER_RATIO, own * FLICKER_LOCAL
                ):
                    flagged.append((n, "flicker", r["static_change"], reference))
        if r["structure"] > structure_threshold and r["structure"] > STRUCTURE_LOCAL * (
            around("structure", n, local_reach, np.median) or 0.0
        ):
            flagged.append((n, "structure", r["structure"], median))
    events: list[dict[str, Any]] = []
    for kind in ("jump", "flicker", "structure"):
        open_event: dict[str, Any] | None = None
        for n, label, value, baseline in flagged:
            if label != kind:
                continue
            if open_event and n - open_event["_last"] <= EVENT_GAP:
                open_event["_last"] = n
                if value > open_event["peak_value"]:
                    open_event.update(_peak=n, peak_value=value, source_value=baseline)
                continue
            open_event = {
                "kind": kind,
                "_first": n,
                "_last": n,
                "_peak": n,
                "peak_value": value,
                "source_value": baseline,
            }
            events.append(open_event)
    events.sort(key=lambda e: (e["_first"], e["kind"]))
    folder = _new_folder(output)
    needed = sorted(
        {m for e in events for m in range(max(0, e["_peak"] - 2), min(len(rows), e["_peak"] + 2))}
    )
    if needed:
        sheet_width = min(240, src["video"]["width"], cand["video"]["width"])
        left = frames(
            src,
            folder / "frames" / "source",
            indices=sorted({rows[m]["source_index"] for m in needed}),
            max_width=sheet_width,
        )
        right = frames(
            cand,
            folder / "frames" / "candidate",
            indices=[rows[m]["index"] for m in needed],
            max_width=sheet_width,
        )
        left_paths = {f["index"]: f["path"] for f in left["frames"]}
        right_paths = {f["index"]: f["path"] for f in right["frames"]}
    for number, event in enumerate(events):
        first, last, peak = event.pop("_first"), event.pop("_last"), event.pop("_peak")
        event.update(
            start_frame=rows[first]["index"],
            end_frame=rows[last]["index"],
            peak_frame=rows[peak]["index"],
            start_seconds=rows[first]["seconds"],
            end_seconds=rows[last]["seconds"],
            source_peak_frame=rows[peak]["source_index"],
            structure_at=rows[peak]["structure_at"] if event["kind"] == "structure" else None,
        )
        shown = [m for m in range(peak - 2, peak + 2) if 0 <= m < len(rows)]
        tiles = []
        for m in shown:
            with (
                Image.open(left_paths[rows[m]["source_index"]]) as a,
                Image.open(right_paths[rows[m]["index"]]) as b,
            ):
                tiles.append((m, a.convert("RGB"), b.convert("RGB").resize(a.size)))
        w, h = tiles[0][1].size
        band = 20
        sheet = Image.new("RGB", (len(tiles) * w, 2 * h + 2 * band), "#1e1e1e")
        draw = ImageDraw.Draw(sheet)
        for slot, (m, a, b) in enumerate(tiles):
            sheet.paste(a, (slot * w, band))
            sheet.paste(b, (slot * w, 2 * band + h))
            draw.text((slot * w + 3, 3), f"source {rows[m]['source_index']}", fill="white")
            mark = " <" if m == peak else ""
            draw.text(
                (slot * w + 3, band + h + 3), f"candidate {rows[m]['index']}{mark}", fill="white"
            )
        path = folder / f"event-{number:02d}-{event['kind']}-{event['peak_frame']}.png"
        sheet.save(path)
        event["sheet"] = str(path)
    return _save(
        folder,
        {
            "kind": "continuity",
            "source": _source_summary(src),
            "candidate": _source_summary(cand),
            "window_seconds": [start, end],
            "analysis_size": list(size),
            "thresholds": {
                "neighbours": CONTINUITY_NEIGHBOURS,
                "static_window": STATIC_WINDOW,
                "static_level": STATIC_LEVEL,
                "jump": {"abs": JUMP_ABS, "ratio": JUMP_RATIO},
                "flicker": {"abs": FLICKER_ABS, "ratio": FLICKER_RATIO, "local": FLICKER_LOCAL},
                "structure": {
                    "threshold": structure_threshold,
                    "median": median,
                    "mad": mad,
                    "k": STRUCTURE_K,
                    "local": STRUCTURE_LOCAL,
                    "floor": STRUCTURE_MIN,
                },
            },
            "events": events,
            "frames": [
                {k: round(v, 3) if isinstance(v, float) else v for k, v in r.items()} for r in rows
            ],
            "reading": "change: mean |luma(t)-luma(t-1)| (0..255) over the whole frame; static_change: "
            "the same over pixels the source keeps still for +-12 frames. structure: largest local "
            "difference of blurred edge maps, candidate vs source at the same time. jump: a whole-frame "
            "change the source lacks; flicker: a still-background change the source lacks; structure: "
            "an extra, missing or misplaced shape. source_value is the source's max within +-2 frames "
            "(jump/flicker) or the film's median structure.",
            "limitations": [
                "Frames pair by timestamp: a retimed or offset candidate reads as structure everywhere.",
                "With different frame rates, change per frame differs in scale between the films.",
                "Events are screening candidates; open each event sheet before acting.",
            ],
        },
        name="continuity.json",
    )


JOIN_SIDE = 0.2  # seconds each side of a join whose source-time offset is compared
JOIN_REACH = 1.0  # a candidate frame may match source frames up to this far from its own time
JOIN_STEP = 3  # within one side of a join, source frames advanced per candidate frame: 0..this
JOIN_TIE = 1e-3  # luma per second from its own time: equal matches resolve to the aligned frame
# A frame's source time is readable only when its best match beats its median match by this
# much (luma, and share of the best match's error); a held shot or grain alone never does.
JOIN_CONTRAST_ABS, JOIN_CONTRAST_REL = 2.0, 0.3


def _forward_path(cost) -> list[int]:
    """Cheapest source-frame path over rows of cost that never goes back or skips ahead.

    One side of a join is one take, so its motion runs forward; a lone best match that jumps
    to a similar-looking moment (a repeated dance step) cannot pull the path with it.
    """
    np = _numpy()
    if len(cost) == 0:
        return []
    total, back = cost[0].copy(), []
    for row in cost[1:]:
        best = np.full_like(total, np.inf)
        arg = np.zeros(len(total), dtype=int)
        for step in range(JOIN_STEP + 1):
            shifted = np.full_like(total, np.inf)
            shifted[step:] = total[: len(total) - step]
            better = shifted < best
            best[better], arg[better] = shifted[better], step
        total = best + row
        back.append(arg)
    path = [int(np.argmin(total))]
    for arg in reversed(back):
        path.append(path[-1] - int(arg[path[-1]]))
    return path[::-1]


def join_timing(
    source: str | Path | Mapping,
    candidate: str | Path | Mapping,
    at: Sequence[float],
    *,
    max_width: int = CONTINUITY_WIDTH,
) -> dict:
    """Measure how far the picture jumps in source time where two generated pieces meet.

    Each candidate frame within JOIN_SIDE of a join is matched to its closest-looking source
    frame within JOIN_REACH. The median offset (source time minus candidate time) after the
    join minus the one before is the jump: positive skips motion forward, negative repeats it.
    A take that lags and then snaps onto its end frame, or one that starts early or stalls,
    reads as a jump even when the join frame itself matches. Only frames whose best match
    clearly beats the rest count; when either side has too few (a held shot, a pause, a
    draft that matches no source moment), the join is returned untimed rather than guessed.
    """
    np = _numpy()
    src, cand = _source(source), _source(candidate)
    src_times = [f["seconds"] for f in src["frames"]]
    cand_times = [f["seconds"] for f in cand["frames"]]
    joins = []
    for join in at:
        picked = [i for i, t in enumerate(cand_times) if abs(t - join) <= JOIN_SIDE]
        near = [
            k
            for k, t in enumerate(src_times)
            if join - JOIN_SIDE - JOIN_REACH <= t and t <= join + JOIN_SIDE + JOIN_REACH
        ]
        if len(picked) < 4 or len(near) < 2:
            joins.append({"at": join, "jump_seconds": None, "reason": "too few frames"})
            continue
        cand_gray = _gray_frames(cand, picked, max_width)
        size = next(iter(cand_gray.values())).shape[::-1]
        src_gray = _gray_frames(src, near, max_width, size)
        stack = np.stack([src_gray[k] for k in near]).astype(np.float32)
        cost = np.stack(
            [np.abs(stack - cand_gray[i].astype(np.float32)).mean(axis=(1, 2)) for i in picked]
        )
        best = cost.min(axis=1)
        readable = np.median(cost, axis=1) - best >= np.maximum(
            JOIN_CONTRAST_ABS, JOIN_CONTRAST_REL * best
        )
        prior = JOIN_TIE * np.abs(
            np.subtract.outer([cand_times[i] for i in picked], [src_times[k] for k in near])
        )
        mapping, offsets = [], []
        for side in (
            [n for n, i in enumerate(picked) if cand_times[i] < join],
            [n for n, i in enumerate(picked) if cand_times[i] >= join],
        ):
            timed = []
            for n, k in zip(side, _forward_path(cost[side] + prior[side])):
                t, s = cand_times[picked[n]], src_times[near[k]]
                mapping.append((t, s, float(cost[n, k]), bool(readable[n])))
                if readable[n]:
                    timed.append(s - t)
            offsets.append(timed if side and 2 * len(timed) >= len(side) else None)
        rows = [[round(t, 3), round(s, 3), round(e, 2), r] for t, s, e, r in mapping]
        before, after = offsets
        if before is None or after is None:
            joins.append(
                {
                    "at": join,
                    "jump_seconds": None,
                    "timed": False,
                    "reason": "the picture barely changes here, or the draft matches no source "
                    "moment, so its source time cannot be read",
                    "mapping": rows,
                }
            )
            continue
        joins.append(
            {
                "at": join,
                "jump_seconds": round(float(np.median(after) - np.median(before)), 3),
                "timed": True,
                "offset_before": round(float(np.median(before)), 3),
                "offset_after": round(float(np.median(after)), 3),
                "match_error": round(float(np.median([e for _, _, e, _ in mapping])), 2),
                "mapping": rows,
            }
        )
    return {
        "kind": "join-timing",
        "source": _source_summary(src),
        "candidate": _source_summary(cand),
        "joins": joins,
        "reading": "mapping: [candidate seconds, closest-looking source seconds, mean luma error, "
        "readable]. jump_seconds: median offset of readable frames after the join minus before; "
        "0 means the motion runs on. timed false: the join could not be timed; read it with "
        "continuity instead.",
        "limitations": [
            "Repetitive motion (a dance step, a spinning fan) can match the wrong source moment; "
            "check mapping and match_error before acting.",
            "Only for a candidate that follows the source's timeline.",
        ],
    }


def _local_regions(geometry: dict, regions: Mapping[str, Any]) -> dict:
    if not isinstance(regions, Mapping):
        raise EvidenceError('regions must be a JSON object, e.g. {"cards":[x,y,w,h]}.')
    ox, oy, w, h = geometry["roi"]
    result = {}
    for name, spec in regions.items():
        box: Any = spec
        ink = None
        if isinstance(spec, Mapping):
            box, ink = spec.get("box"), spec.get("ink")
            if ink not in (None, "dark", "light"):
                raise EvidenceError(f"Region {name!r} ink must be dark or light.")
        if (
            not isinstance(box, Sequence)
            or len(box) != 4
            or any(isinstance(v, bool) or not isinstance(v, int) for v in box)
        ):
            raise EvidenceError(
                f'Region {name!r} must be [x,y,width,height] integers or {{"box":[...],"ink":"dark"}}.'
            )
        x, y, bw, bh = box
        if bw < 5 or bh < 5 or x < ox or y < oy or x + bw > ox + w or y + bh > oy + h:
            raise EvidenceError(
                f"Region {name!r} {list(box)} must be at least 5x5 and inside the compared area "
                f"{[ox, oy, w, h]} (coded source pixels)."
            )
        result[name] = ((x - ox, y - oy, bw, bh), (x, y), ink)
    return result


def _luma(rgb):
    np = _numpy()
    return rgb.astype(np.float64) @ np.array([0.2126, 0.7152, 0.0722])


def _box_blur(values, size: int = 5):
    np = _numpy()
    r = size // 2
    padded = np.pad(values, r, mode="edge").cumsum(0).cumsum(1)
    padded = np.pad(padded, ((1, 0), (1, 0)))
    total = (
        padded[size:, size:]
        - padded[:-size, size:]
        - padded[size:, :-size]
        + padded[:-size, :-size]
    )
    return total / (size * size)


def _otsu(luma) -> int:
    np = _numpy()
    hist = np.bincount(np.clip(np.rint(luma), 0, 255).astype(int).ravel(), minlength=256)
    p = hist / hist.sum()
    omega, mu = np.cumsum(p), np.cumsum(p * np.arange(256))
    with np.errstate(divide="ignore", invalid="ignore"):
        between = (mu[-1] * omega - mu) ** 2 / (omega * (1 - omega))
    return int(np.nanargmax(between))


def _ink_box(luma, origin, polarity: str | None = None) -> dict:
    """Otsu split of a region; ink is the minority side (or the given polarity)."""
    np = _numpy()
    if float(luma.max() - luma.min()) < 24:
        return {"threshold": None, "polarity": polarity, "bbox": None, "coverage": 0.0}
    threshold = _otsu(luma)
    light = luma > threshold
    if polarity is None:
        polarity = "light" if light.mean() <= 0.5 else "dark"
    ink = light if polarity == "light" else ~light
    ys, xs = np.nonzero(ink)
    bbox = None
    if len(xs):
        x, y = int(xs.min()), int(ys.min())
        bbox = [origin[0] + x, origin[1] + y, int(xs.max()) - x + 1, int(ys.max()) - y + 1]
    return {
        "threshold": threshold,
        "polarity": polarity,
        "bbox": bbox,
        "coverage": float(ink.mean()),
    }


def _region_metrics(left, right, box, origin, polarity=None) -> dict:
    np = _numpy()
    x, y, w, h = box
    a, b = left[y : y + h, x : x + w], right[y : y + h, x : x + w]
    la, lb = _luma(a), _luma(b)
    sharp = [float(np.std(v - _box_blur(v))) for v in (la, lb)]
    contrast = [float(np.std(v)) for v in (la, lb)]
    detail = [s / c if c > 0 else None for s, c in zip(sharp, contrast)]
    ink_a = _ink_box(la, origin, polarity)
    ink_b = _ink_box(lb, origin, ink_a["polarity"])

    def ratio(top, bottom):
        return top / bottom if top is not None and bottom else None

    size = None
    if ink_a["bbox"] and ink_b["bbox"]:
        size = {
            "width": ink_b["bbox"][2] / ink_a["bbox"][2],
            "height": ink_b["bbox"][3] / ink_a["bbox"][3],
        }
    return {
        "box": [origin[0], origin[1], w, h],
        "highpass_std": {"reference": sharp[0], "candidate": sharp[1]},
        "sharpness_ratio": ratio(sharp[1], sharp[0]),
        "highpass_to_contrast": {"reference": detail[0], "candidate": detail[1]},
        "detail_ratio": ratio(detail[1], detail[0]),
        "mean_rgb": {
            "reference": a.reshape(-1, 3).mean(axis=0).tolist(),
            "candidate": b.reshape(-1, 3).mean(axis=0).tolist(),
        },
        "mae_rgb_255": float(np.abs(a.astype(float) - b.astype(float)).mean()),
        "ink": {"reference": ink_a, "candidate": ink_b, "size_ratio": size},
        "reading": "sharpness_ratio < 1: candidate softer; > 1: candidate sharper than the reference.",
    }


def _frame_window(source: dict, start: float, end: float | None) -> list[int]:
    if (
        _number(start) is None
        or start < 0
        or (end is not None and (_number(end) is None or end <= start))
    ):
        raise EvidenceError("Expected seconds with 0 <= start < end.")
    picked = [
        f["index"]
        for f in source["frames"]
        if f["seconds"] >= start and (end is None or f["seconds"] < end)
    ]
    if len(picked) < 3:
        raise EvidenceError(
            f"Only {len(picked)} native frames fall in [{start}, {end}); widen the window."
        )
    return picked


def _frame_seconds(source: dict) -> float:
    np = _numpy()
    times = [f["seconds"] for f in source["frames"]]
    steps = np.diff(times)
    steps = steps[steps > 0]
    if not len(steps):
        raise EvidenceError("Cannot measure frame spacing from fewer than two distinct PTS.")
    return float(np.median(steps))


def _ink_series(
    source: dict, indices: list[int], roi, tolerance: float, max_width: int
) -> list[dict]:
    """Per native frame: share of ROI pixels far from the ROI border's median color, and luma change."""
    np = _numpy()
    geometry = _geometry(source, roi, max_width)
    rows, previous = [], None
    for index, rgb in _decode(source, indices, geometry):
        pixels = rgb.astype(np.int16)
        border = np.concatenate([pixels[0], pixels[-1], pixels[:, 0], pixels[:, -1]])
        background = np.median(border, axis=0)
        ink = np.abs(pixels - background).max(axis=2) > tolerance
        luma = _luma(rgb)
        rows.append(
            {
                "index": index,
                "seconds": source["frames"][index]["seconds"],
                "ink_fraction": float(ink.mean()),
                "change": None if previous is None else float(np.abs(luma - previous).mean()),
            }
        )
        previous = luma
    return rows


INK_SHARE_BAND = 0.03  # cadence: a progress level matches within this share of final ink


def _reveal_progress(ink) -> list[float]:
    """Ink above the first frame as a share of the final ink (median of the last three frames)."""
    np = _numpy()
    final = float(np.median(ink[-3:])) - float(ink[0])
    if abs(final) <= 1e-4:
        raise EvidenceError(
            "Ink at the end of the window equals the start; end the window after the reveal settles."
        )
    return ((ink - ink[0]) / final).tolist()


def _first_reaching(rows: list[dict], progress: list[float], level: float) -> dict | None:
    return next((r for r, p in zip(rows, progress) if p >= level), None)


def cadence(
    source: str | Path | Mapping,
    *,
    roi: Sequence[int],
    start: float,
    end: float,
    candidate: str | Path | Mapping | None = None,
    candidate_roi: Sequence[int] | None = None,
    tolerance: float = 40,
    change_threshold: float | None = None,
    max_width: int = 640,
) -> dict:
    """Measure discrete reveal/typing steps in a ROI and, optionally, a candidate's lead or lag.

    Both sides use the same video-local [start, end) seconds. Progress is ink fraction
    normalized to its own minimum..maximum in the window.
    """
    np = _numpy()
    if _number(tolerance) is None or tolerance < 0:
        raise EvidenceError("tolerance must be a nonnegative 0..255 color distance.")
    src = _source(source)
    rows = _ink_series(src, _frame_window(src, start, end), roi, tolerance, max_width)
    changes = np.array([r["change"] for r in rows[1:]])
    threshold = (
        change_threshold if change_threshold is not None else max(0.5, 0.25 * float(changes.max()))
    )
    hot = changes > threshold
    events, holds, run = [], [], 0
    for i, flag in enumerate(hot):
        row = rows[i + 1]
        if flag and (i == 0 or not hot[i - 1]):
            events.append({k: row[k] for k in ("index", "seconds", "change", "ink_fraction")})
        if flag:
            if run >= 2:
                holds.append({"from_index": rows[i + 1 - run]["index"], "frames": run})
            run = 0
        else:
            run += 1
    if run >= 2:
        holds.append({"from_index": rows[-run]["index"], "frames": run})
    gaps = np.diff([e["index"] for e in events])
    span = rows[-1]["seconds"] - rows[0]["seconds"]
    ink = np.array([r["ink_fraction"] for r in rows])
    spread = float(ink.max() - ink.min())
    progress = ((ink - ink.min()) / spread).tolist() if spread > 1e-4 else None
    onset = _first_reaching(rows, progress, 0.2) if progress else None
    result: dict[str, Any] = {
        "kind": "cadence",
        "source": _source_summary(src),
        "roi": list(_roi(src, roi)),
        "window_seconds": [start, end],
        "frames_measured": len(rows),
        "change_threshold": threshold,
        "events": events,
        "events_per_second": len(events) / span if span > 0 else None,
        "frames_between_events": {
            "median": float(np.median(gaps)),
            "min": int(gaps.min()),
            "max": int(gaps.max()),
        }
        if len(gaps)
        else None,
        "holds": holds,
        "onset_20_percent": {"index": onset["index"], "seconds": onset["seconds"]}
        if onset
        else None,
        "frames": [{**r, "progress": p} for r, p in zip(rows, progress or [None] * len(rows))],
        "limitations": [
            "Ink is any ROI pixel farther than tolerance from the ROI border's median color; a cursor, caret blink or background motion also counts.",
            "Progress is ink amount, not text identity; inspect mid-reveal frames to confirm the right characters are visible.",
            "Events are frame-to-frame luma changes above change_threshold; set it explicitly when the automatic 25%-of-peak value merges or splits steps.",
        ],
    }
    if candidate is None:
        return result
    cand = _source(candidate)
    cand_rows = _ink_series(
        cand, _frame_window(cand, start, end), candidate_roi or roi, tolerance, max_width
    )
    cand_ink = np.array([r["ink_fraction"] for r in cand_rows])
    cand_spread = float(cand_ink.max() - cand_ink.min())
    if not progress or cand_spread <= 1e-4:
        raise EvidenceError(
            "Reference or candidate ink does not change in this ROI/window; check the ROI, window and tolerance."
        )
    cand_progress = ((cand_ink - cand_ink.min()) / cand_spread).tolist()
    frame = _frame_seconds(src)
    ref_reveal, cand_reveal = _reveal_progress(ink), _reveal_progress(cand_ink)
    samples = []
    # Judge only 5-90% of the final ink: the settle after the last glyph and caret blinks
    # move the top of the curve without changing when the text appears. One curve's level
    # may match the other's within +-INK_SHARE_BAND, so different glyph widths or a fade's
    # overshoot do not read as lead; the smaller of the two one-sided matches is kept.
    steps = round(INK_SHARE_BAND * 100)
    band = [k / 100 for k in range(-steps, steps + 1)]

    def crossings(table: list[dict], curve: list[float], level: float) -> list[float]:
        return [
            r["seconds"] for d in band if (r := _first_reaching(table, curve, level + d - 1e-9))
        ]

    for level in [round(0.05 * k, 2) for k in range(1, 19)]:
        ref_row = _first_reaching(rows, ref_reveal, level - 1e-9)
        cand_row = _first_reaching(cand_rows, cand_reveal, level - 1e-9)
        if not (ref_row and cand_row):
            continue
        options = [ref_row["seconds"] - t for t in crossings(cand_rows, cand_reveal, level)]
        options += [t - cand_row["seconds"] for t in crossings(rows, ref_reveal, level)]
        samples.append(
            {
                "progress": level,
                "reference_seconds": ref_row["seconds"],
                "candidate_seconds": cand_row["seconds"],
                "lead_frames": min(options, key=abs) / frame,
            }
        )
    leads = [s["lead_frames"] for s in samples]
    result["candidate"] = {
        "source": _source_summary(cand),
        "roi": list(_roi(cand, candidate_roi or roi)),
        "frames": [{**r, "progress": p} for r, p in zip(cand_rows, cand_progress)],
        "alignment": samples,
        "max_lead_frames": max(leads),
        "max_lag_frames": -min(leads),
        "median_lead_frames": float(np.median(leads)),
        "judged_progress": [0.05, 0.9],
        "reading": "Positive lead: the candidate reaches that share of its final ink earlier than the reference (runs ahead). Judged on 5-90% of each curve's final ink (median of its last three frames) above its first frame; a level matches within +-3% of ink.",
    }
    return result


MOTION_PROPS = ("amount", "x", "y", "scale", "sharpness")
# A property counts as moving when the source's range exceeds its floor; the floor also
# normalises a still property's error. amount/scale/sharpness: share of the source's peak;
# x/y: share of the ROI width.
MOTION_FLOORS = {"amount": 0.05, "x": 0.02, "y": 0.02, "scale": 0.05, "sharpness": 0.1}
MOTION_MAX_LAG = 8  # frames searched each way for the timing offset
MOTION_VISIBLE = 0.1  # x/y/scale/sharpness compare only frames with this share of peak amount
SHADOW_RINGS = 12  # analysis pixels outside the ink sampled for the shadow/glow profile


def _motion_series(source: dict, indices: list[int], roi, width: int) -> dict:
    """Per frame: soft ink amount, centroid, RMS radius and edge sharpness of the ROI's ink."""
    np, cv2 = _numpy(), _opencv()
    geometry = _geometry(source, roi, width)
    frames = [(i, rgb.astype(np.float32)) for i, rgb in _decode(source, indices, geometry)]
    border = np.concatenate([np.concatenate([f[0], f[-1], f[:, 0], f[:, -1]]) for _, f in frames])
    background = np.median(border, axis=0)
    distance = [np.abs(f - background).max(axis=2) for _, f in frames]
    peak = max(float(np.quantile(np.stack(distance), 0.995)), 20.0)
    h, w = distance[0].shape
    yy, xx = np.indices((h, w))
    rows = []
    for (index, rgb), d in zip(frames, distance):
        weight = np.clip(d / peak, 0, 1)
        total = float(weight.sum())
        row = {"index": index, "seconds": source["frames"][index]["seconds"]}
        row["amount"] = total / weight.size
        if total < 1:
            row.update(x=None, y=None, scale=None, sharpness=None)
        else:
            cx, cy = float((weight * xx).sum() / total), float((weight * yy).sum() / total)
            radius = float(np.sqrt((weight * ((xx - cx) ** 2 + (yy - cy) ** 2)).sum() / total))
            luma = _luma(rgb)
            edges = np.abs(cv2.Laplacian(luma, cv2.CV_64F))
            row.update(
                x=cx / w,
                y=cy / w,
                scale=radius / w,
                sharpness=float((edges * weight).sum() / total),
            )
        rows.append(row)
    # Shadow/glow profile on the last frame: mean contrast at 1..SHADOW_RINGS px outside the ink.
    last = distance[-1]
    ink = (last > peak / 2).astype(np.uint8)
    profile = [0.0] * SHADOW_RINGS
    if ink.any():
        away = cv2.distanceTransform(1 - ink, cv2.DIST_L2, 3)
        for k in range(SHADOW_RINGS):
            ring = (away > k + 0.5) & (away <= k + 1.5)
            profile[k] = float(last[ring].mean() / peak) if ring.any() else 0.0
    return {"rows": rows, "shadow_profile": profile, "geometry": geometry}


def _normalised(rows: list[dict], reference: list[dict]) -> dict[str, list]:
    """Each property on the reference's scale, so 1.0 means one reference peak (or ROI width)."""
    out: dict[str, list] = {}
    for prop in MOTION_PROPS:
        ref = [r[prop] for r in reference if r[prop] is not None]
        unit = max(ref) if ref and prop in ("amount", "scale", "sharpness") else 1.0
        out[prop] = [None if r[prop] is None else r[prop] / (unit or 1.0) for r in rows]
    return out


def _motion_error(ref: dict, cand: dict, ranges: dict, lag: int) -> dict[str, float | None]:
    """Mean absolute difference per property, cand shifted by lag frames, over its range."""
    errors: dict[str, float | None] = {}
    n = len(ref["amount"])
    for prop in MOTION_PROPS:
        diffs = []
        for t in range(n):
            u = t + lag
            if not 0 <= u < len(cand[prop]):
                continue
            a, b = ref[prop][t], cand[prop][u]
            if prop != "amount" and (
                a is None
                or b is None
                or ref["amount"][t] < MOTION_VISIBLE
                or cand["amount"][u] < MOTION_VISIBLE
            ):
                continue
            if a is not None and b is not None:
                diffs.append(abs(a - b))
        errors[prop] = sum(diffs) / len(diffs) / ranges[prop] if diffs else None
    return errors


def _flow_series(source: dict, start: float, end: float, roi, max_width: int) -> list[dict]:
    np, cv2 = _numpy(), _opencv()
    geometry = _geometry(source, roi, max_width)
    grays = [
        cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        for _, rgb in _decode(source, _frame_window(source, start, end), geometry)
    ]
    return flow_math.series(grays, np, cv2)


def flow(
    source: str | Path | Mapping,
    candidate: str | Path | Mapping,
    output: str | Path | None = None,
    *,
    roi: Sequence[int],
    start: float,
    end: float,
    candidate_roi: Sequence[int] | None = None,
    candidate_start: float | None = None,
    max_width: int = 160,
) -> dict:
    """One element's motion, reference against rebuild, by dense optical flow inside its box.

    On one clock over the same footage the footage's own motion cancels, so what differs is the element: motion
    energy (energy_ratio), the shape of its motion over time (motion_corr at the best lag within 3 frames), and its
    path, scale and rotation. Fonts and content do not move the numbers, as they do SSIM.
    """
    src, cand = _source(source), _source(candidate)
    if candidate_roi is None:
        k = cand["video"]["width"] / src["video"]["width"]
        candidate_roi = [round(v * k) for v in roi]
    offset = (candidate_start if candidate_start is not None else start) - start
    ref_rows = _flow_series(src, start, end, roi, max_width)
    cand_rows = _flow_series(cand, start + offset, end + offset, candidate_roi, max_width)
    return flow_math.compare(ref_rows, cand_rows)


def flow_track(
    source: str | Path | Mapping,
    output: str | Path | None = None,
    *,
    roi: Sequence[int],
    start: float,
    end: float,
    max_width: int = 320,
) -> dict:
    """Reverse one element's moves from optical flow: each move between holds as a tween (start, duration, x, y in
    source pixels, scale, rotation, the closest GSAP ease and any overshoot)."""
    src = _source(source)
    rows = _flow_series(src, start, end, roi, max_width)
    fps = len(_frame_window(src, start, end)) / (end - start)
    result = flow_math.track(rows, fps, _roi(src, roi))
    for move in result["moves"]:
        move["start"] = round(move["start"] + start, 3)
    return result


def motion(
    source: str | Path | Mapping,
    candidate: str | Path | Mapping,
    output: str | Path | None = None,
    *,
    roi: Sequence[int],
    start: float,
    end: float,
    candidate_roi: Sequence[int] | None = None,
    max_width: int = 320,
) -> dict:
    """Compare how one element enters, moves, settles or leaves: timing and curve shape.

    Per frame in [start, end): soft ink amount (opacity and reveal), centroid x/y, RMS radius
    (scale) and edge sharpness (blur), plus the shadow/glow profile around the settled ink.
    The candidate ROI defaults to --roi scaled by the canvas width ratio. match is 1 minus the
    mean difference over the source's range of each property, after removing the timing lag.
    """
    np = _numpy()
    src, cand = _source(source), _source(candidate)
    if candidate_roi is None:
        k = cand["video"]["width"] / src["video"]["width"]
        candidate_roi = [round(v * k) for v in roi]
    width = min(max_width, int(_roi(src, roi)[2]))
    ref_series = _motion_series(src, _frame_window(src, start, end), roi, width)
    cand_series = _motion_series(cand, _frame_window(cand, start, end), candidate_roi, width)
    ref_rows, cand_rows = ref_series["rows"], cand_series["rows"]
    if max(r["amount"] for r in ref_rows) <= 0:
        raise EvidenceError("No ink in the source ROI over this window; check the ROI and window.")
    ref = _normalised(ref_rows, ref_rows)
    got = _normalised(cand_rows, ref_rows)
    ranges, moving = {}, []
    for prop in MOTION_PROPS:
        values = [v for v in ref[prop] if v is not None]
        span = (max(values) - min(values)) if values else 0.0
        ranges[prop] = max(span, MOTION_FLOORS[prop])
        if span > MOTION_FLOORS[prop]:
            moving.append(prop)

    def total(errors: dict) -> float:
        # Timing comes from where and how much: blur is a style the candidate may lack.
        known = [
            e
            for p, e in errors.items()
            if e is not None and p != "sharpness" and (p in moving or p == "amount")
        ]
        return sum(known) / len(known) if known else 0.0

    lag = min(
        range(-MOTION_MAX_LAG, MOTION_MAX_LAG + 1),
        key=lambda L: (round(total(_motion_error(ref, got, ranges, L)), 4), abs(L)),
    )
    errors = _motion_error(ref, got, ranges, lag)
    match = {p: None if e is None else round(max(0.0, 1 - e), 3) for p, e in errors.items()}
    shown = [v for p in MOTION_PROPS if (v := match[p]) is not None]
    a, b = np.array(ref_series["shadow_profile"]), np.array(cand_series["shadow_profile"])
    shadow_scale = max(float(a[1:].max()), 0.05)
    shadow = round(max(0.0, 1 - float(np.abs(a[1:] - b[1:]).mean()) / shadow_scale), 3)

    def crossing(rows: list[dict], level: float) -> float | None:
        top = max(r["amount"] for r in rows) or 1.0
        hit = next((r for r in rows if r["amount"] >= level * top), None)
        return hit["seconds"] if hit else None

    result: dict[str, Any] = {
        "kind": "motion",
        "source": _source_summary(src),
        "candidate": _source_summary(cand),
        "roi": list(_roi(src, roi)),
        "candidate_roi": list(_roi(cand, candidate_roi)),
        "window_seconds": [start, end],
        "lag_frames": lag,
        "moving": moving,
        "match": match,
        "overall_match": min(shown) if shown else None,
        "shadow_match": shadow,
        "shadow_profile": {
            "source": [round(v, 3) for v in a],
            "candidate": [round(v, 3) for v in b],
        },
        "amount_10_90_seconds": {
            "source": [crossing(ref_rows, 0.1), crossing(ref_rows, 0.9)],
            "candidate": [crossing(cand_rows, 0.1), crossing(cand_rows, 0.9)],
        },
        "reading": "lag_frames > 0: the candidate is late. match per property is 1 minus its mean "
        "difference over the source's range after removing the lag (amount: opacity and reveal; "
        "x/y: position; scale: size; sharpness: blur). overall_match is the lowest property. "
        "shadow_match compares contrast 2-12 analysis px outside the settled ink.",
        "limitations": [
            "Ink is contrast against the ROI border's median color over the window: keep other "
            "moving content out of the ROI and the whole motion inside it.",
            "Properties describe the ROI's ink as one blob; several elements in one ROI average.",
        ],
    }
    if output is not None:
        folder = _new_folder(output)
        picks = sorted({round(i * (len(ref_rows) - 1) / 5) for i in range(6)})
        left = frames(
            src,
            folder / "source",
            indices=[ref_rows[i]["index"] for i in picks],
            roi=list(_roi(src, roi)),
            max_width=width,
        )
        right = frames(
            cand,
            folder / "candidate",
            indices=[cand_rows[min(len(cand_rows) - 1, max(0, i + lag))]["index"] for i in picks],
            roi=list(_roi(cand, candidate_roi)),
            max_width=width,
        )
        Image, ImageDraw = _pillow()
        tiles = [
            (Image.open(x["path"]).convert("RGB"), Image.open(y["path"]).convert("RGB"))
            for x, y in zip(left["frames"], right["frames"])
        ]
        tw, th = tiles[0][0].size
        strip = Image.new("RGB", (tw * len(tiles), 2 * th + 16), "#1e1e1e")
        draw = ImageDraw.Draw(strip)
        for n, (x_img, y_img) in enumerate(tiles):
            strip.paste(x_img, (n * tw, 0))
            strip.paste(y_img.resize((tw, th)), (n * tw, th + 16))
        draw.text((3, th + 2), f"source (top) | candidate shifted {lag:+d} frames", fill="white")
        path = folder / "motion-strip.png"
        strip.save(path)
        result["strip"] = str(path)
    return result


def _audio_samples(source: dict, start: float, end: float, rate: int):
    np = _numpy()
    stream = source["audio"][0]
    origin = source["video"]["origin_timestamp"]
    absolute = origin + start
    raw = _run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-copyts",
            "-i",
            source["path"],
            "-map",
            f"0:{stream['index']}",
            "-vn",
            "-af",
            f"atrim=start={absolute:.6f}:end={origin + end:.6f},"
            f"asetpts=PTS-({absolute:.6f})/TB,aresample=async=1:first_pts=0",
            "-ac",
            "1",
            "-ar",
            str(rate),
            "-f",
            "f32le",
            "pipe:1",
        ]
    )
    return np.frombuffer(raw, dtype=np.float32)


def _pearson(a, b) -> float | None:
    np = _numpy()
    if len(a) < 10 or np.std(a) == 0 or np.std(b) == 0:
        return None
    return float(np.corrcoef(a, b)[0, 1])


def av_sync(
    source: str | Path | Mapping,
    *,
    mouth_roi: Sequence[int],
    start: float = 0,
    end: float | None = None,
    max_lag_ms: float = 400,
) -> dict:
    """Estimate picture-vs-sound offset from mouth motion and the speech envelope.

    Per native frame: mean absolute luma change in the mouth ROI, and the absolute
    change of the audio RMS over that frame's interval. The lag maximizing their
    Pearson correlation is reported; positive means the picture is late.
    """
    np = _numpy()
    src = _source(source)
    if not src["audio"]:
        raise EvidenceError("av-sync needs an audio stream in the same file as the picture.")
    if _number(max_lag_ms) is None or max_lag_ms <= 0:
        raise EvidenceError("max_lag_ms must be positive.")
    if end is None:
        end = src["video"]["duration"] or src["frames"][-1]["seconds"] + _frame_seconds(src)
    indices = _frame_window(src, start, end)
    geometry = _geometry(src, mouth_roi, 160)
    motion, previous = [], None
    for _, rgb in _decode(src, indices, geometry):
        luma = _luma(rgb)
        motion.append(0.0 if previous is None else float(np.abs(luma - previous).mean()))
        previous = luma
    rate = 16000
    samples = _audio_samples(src, start, end, rate)
    rms = []
    for index in indices:
        frame = src["frames"][index]
        a = int((frame["seconds"] - start) * rate)
        b = int((frame["seconds"] + (frame["duration_seconds"] or 0) - start) * rate)
        chunk = samples[a : max(b, a + 1)]
        rms.append(float(np.sqrt(np.mean(chunk.astype(np.float64) ** 2))) if len(chunk) else 0.0)
    envelope = np.array(rms)
    speech = np.abs(np.diff(envelope))
    mouth = np.array(motion[1:])
    frame = _frame_seconds(src)
    reach = max(1, round(max_lag_ms / 1000 / frame))
    curve: list[dict[str, Any]] = []
    for lag in range(-reach, reach + 1):
        a, b = (
            (speech[: len(speech) - lag], mouth[lag:]) if lag >= 0 else (speech[-lag:], mouth[:lag])
        )
        curve.append({"lag_frames": lag, "correlation": _pearson(a, b)})
    valid = [c for c in curve if c["correlation"] is not None]
    active = float((envelope > 0.1 * envelope.max()).mean()) if envelope.max() > 0 else 0.0
    result: dict[str, Any] = {
        "kind": "av_sync",
        "source": _source_summary(src),
        "mouth_roi": list(_roi(src, mouth_roi)),
        "window_seconds": [start, end],
        "frame_seconds": frame,
        "speech_active_fraction": active,
        "mouth_motion_mean": float(mouth.mean()),
        "curve": curve,
        "limitations": [
            "A motion/energy proxy, not phoneme or viseme sync: head motion, gestures, cuts and music in the ROI or mix move it.",
            "Use a tight mouth ROI over a window without cuts; repeat on several windows and listen/watch when the host can play media.",
            "Positive lag means the picture is late (mouth moves after the sound).",
        ],
    }
    if not valid:
        result.update(best_lag_ms=None, peak_correlation=None, confidence="none")
        result["note"] = (
            "No mouth motion or no audio change in this window; check the ROI and window."
        )
        return result
    values = np.array([np.nan if c["correlation"] is None else c["correlation"] for c in curve])
    best = int(np.nanargmax(values))
    peak = float(values[best])
    shift = 0.0
    if 0 < best < len(curve) - 1 and not np.isnan(values[best - 1 : best + 2]).any():
        left, right = float(values[best - 1]), float(values[best + 1])
        bend = left - 2 * peak + right
        shift = 0.5 * (left - right) / bend if bend < 0 else 0.0
    lag = curve[best]["lag_frames"]
    rest = [float(v) for c, v in zip(curve, values) if abs(c["lag_frames"] - lag) > 2 and v == v]
    margin = peak - max(rest) if rest else None
    edge = best in (0, len(curve) - 1)
    if peak >= 0.5 and margin is not None and margin >= 0.1 and not edge and active >= 0.1:
        confidence = "high"
    elif peak >= 0.3 and not edge:
        confidence = "medium"
    else:
        confidence = "low"
    notes = []
    if edge:
        notes.append("Peak is at the search edge; raise --max-lag-ms or check the window.")
    if active < 0.1:
        notes.append("Little speech in this window; choose a span with continuous speech.")
    result.update(
        best_lag_frames=lag + shift,
        best_lag_ms=(lag + shift) * frame * 1000,
        peak_correlation=peak,
        zero_lag_correlation=next(c["correlation"] for c in curve if c["lag_frames"] == 0),
        margin_over_other_lags=margin,
        confidence=confidence,
        note=" ".join(notes) or None,
    )
    return result


# Video 1 likeness by face height / frame height (harness face-size eval, 2026-10-08): it holds from
# FACE_HOLDS, slides about 0.05 per chained join down to FACE_SLIDES and about 0.09 below it, and
# under FACE_FLOOR Video 1 cannot carry a likeness at all.
FACE_HOLDS, FACE_SLIDES, FACE_FLOOR = 0.25, 0.15, 0.06


def face_verdict(height: float | None, *, cast: bool = False) -> str:
    """pass, warn or fail for a face height share; a cast person's likeness fails below FACE_SLIDES."""
    if height is None:
        return "unmeasured"
    if height >= FACE_HOLDS:
        return "pass"
    return "fail" if height < (FACE_SLIDES if cast else FACE_FLOOR) else "warn"


# Worst first: a range is no better than its median or its handoff (last) frame.
_FACE_ORDER = ("fail", "unmeasured", "warn", "pass")


def face_summary(samples: Sequence[tuple[int, Sequence[float]]], *, cast: bool = False) -> dict:
    """Grade face-height shares per sampled frame, in time order; the last frame is the handoff.

    A cast person can be any face in a crowded frame, so cast mode reads the smallest face and
    never lets a larger extra pass for them; otherwise the largest face is the subject.
    """
    np = _numpy()
    pick = min if cast else max
    heights = [{"frame": f, "face_height": pick(h)} for f, h in samples if h]
    height = float(np.median([h["face_height"] for h in heights])) if heights else None
    last_frame, last_faces = samples[-1]
    last = pick(last_faces) if last_faces else None
    verdicts = (face_verdict(height, cast=cast), face_verdict(last, cast=cast))
    return {
        "frames_sampled": len(samples),
        "frames_with_face": heights,
        "face_height": height,
        "median_verdict": verdicts[0],
        "last_frame": last_frame,
        "last_face_height": last,
        "last_verdict": verdicts[1],
        "cast": cast,
        "verdict": min(verdicts, key=_FACE_ORDER.index),
        "bands": {"pass": FACE_HOLDS, "cast_fail_below": FACE_SLIDES, "fail_below": FACE_FLOOR},
        "note": None
        if last is not None
        else "No face found at the last sampled frame (turned away, occluded, out of frame or "
        "missed); look at the frames instead.",
    }


def face_boxes(
    samples: Sequence[tuple[int, Sequence[Sequence[float]]]], *, cast: bool = False
) -> list[dict]:
    """The subject's face box per sampled frame as [x, y, width, height] shares of the frame,
    picked as face_summary picks its height: the largest face, or the smallest with cast."""
    pick = min if cast else max
    return [
        {"frame": f, "box": [round(v, 4) for v in pick(faces, key=lambda b: b[3])]}
        for f, faces in samples
        if faces
    ]


def face_size(
    source: str | Path | Mapping,
    *,
    start: float = 0,
    end: float | None = None,
    samples: int = 12,
    cast: bool = False,
) -> dict:
    """face_summary and face_boxes over evenly spaced frames of [start, end), the window's last
    frame included."""
    source = _source(source)
    cv2, np = _opencv(), _numpy()
    picked = [
        f["index"]
        for f in source["frames"]
        if f["seconds"] >= start and (end is None or f["seconds"] < end)
    ]
    if not picked or samples < 1:
        raise EvidenceError(f"No native frame falls in [{start}, {end}), or samples < 1.")
    if len(picked) > samples:
        picked = [picked[int(i)] for i in np.linspace(0, len(picked) - 1, samples).round()]
    # ponytail: OpenCV's bundled Haar cascades, not the harness's YuNet; the bands are coarse enough.
    cascades = [
        cv2.CascadeClassifier(cv2.data.haarcascades + name)
        for name in ("haarcascade_frontalface_alt2.xml", "haarcascade_profileface.xml")
    ]
    geometry = _geometry(source, max_width=960)
    measured = []
    for index, rgb in _decode(source, picked, geometry):
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        boxes = [
            box
            for cascade in cascades
            for box in cascade.detectMultiScale(gray, 1.1, 5, minSize=(20, 20))
        ]
        h, w = gray.shape
        measured.append((index, [[b[0] / w, b[1] / h, b[2] / w, b[3] / h] for b in boxes]))
    heights = [(index, [b[3] for b in faces]) for index, faces in measured]
    return {
        "source": _source_summary(source),
        **face_summary(heights, cast=cast),
        "face_boxes": face_boxes(measured, cast=cast),
    }


_WORD_KEYS = ("word_segments", "words", "word_timestamps")


def load_words(path: str | Path) -> list[dict]:
    """Read word timings from HeyGen, WhisperX, TTS word_timestamps or a plain word list."""
    try:
        data = json.loads(Path(path).expanduser().read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise EvidenceError(f"Cannot read transcript JSON {path}: {exc}") from exc
    if isinstance(data, dict) and isinstance(data.get("data"), dict):
        data = data["data"]
    items: Any = None
    if isinstance(data, list):
        items = data
    elif isinstance(data, dict):
        items = next((data[k] for k in _WORD_KEYS if isinstance(data.get(k), list)), None)
        if items is None and isinstance(data.get("segments"), list):
            items = [
                w
                for segment in data["segments"]
                for w in (segment.get("words") or segment.get("word_timestamps") or [])
            ]
    if not items:
        raise EvidenceError(
            f"{path} has no word timings. Expected a word list, words/word_segments/word_timestamps, "
            "or segments[].words with word|text, start and end in seconds."
        )
    words = []
    for item in items:
        if not isinstance(item, dict):
            raise EvidenceError(f"{path}: each word must be an object with word|text, start, end.")
        text = str(item.get("word", item.get("text", ""))).strip()
        if not text or re.fullmatch(r"<[^>]*>|\[[^\]]*\]", text):
            continue
        words.append(
            {"word": text, "start": _number(item.get("start")), "end": _number(item.get("end"))}
        )
    return words


def _norm(word: str) -> str:
    return re.sub(r"[\W_]+", "", word.casefold())


def word_drift(reference: str | Path, candidate: str | Path) -> dict:
    """Align two word-timestamp lists by normalized text and report start-time offsets."""
    from difflib import SequenceMatcher

    np = _numpy()
    ref, cand = load_words(reference), load_words(candidate)
    ref = [w for w in ref if _norm(w["word"])]
    cand = [w for w in cand if _norm(w["word"])]
    matcher = SequenceMatcher(
        None, [_norm(w["word"]) for w in ref], [_norm(w["word"]) for w in cand], autojunk=False
    )
    matched: list[dict] = []
    missing: list[dict] = []
    extra: list[dict] = []
    replaced: list[dict] = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            for i, j in zip(range(i1, i2), range(j1, j2)):
                a, b = ref[i], cand[j]
                offset = b["start"] - a["start"] if None not in (a["start"], b["start"]) else None
                matched.append(
                    {
                        "word": a["word"],
                        "reference_start": a["start"],
                        "candidate_start": b["start"],
                        "offset_seconds": offset,
                    }
                )
        if tag in ("delete", "replace"):
            group = missing if tag == "delete" else replaced
            group.append(
                {
                    "reference": " ".join(w["word"] for w in ref[i1:i2]),
                    "reference_start": ref[i1]["start"],
                    **(
                        {"candidate": " ".join(w["word"] for w in cand[j1:j2])}
                        if tag == "replace"
                        else {}
                    ),
                }
            )
        if tag == "insert":
            extra.append(
                {
                    "candidate": " ".join(w["word"] for w in cand[j1:j2]),
                    "candidate_start": cand[j1]["start"],
                }
            )
    timed = [m for m in matched if m["offset_seconds"] is not None]
    if not timed:
        raise EvidenceError(
            "No timed words match between the two transcripts; check language and files."
        )
    offsets = np.array([m["offset_seconds"] for m in timed])
    starts = np.array([m["reference_start"] for m in timed])
    slope = (
        float(np.polyfit(starts, offsets, 1)[0]) if len(timed) > 2 and np.ptp(starts) > 0 else None
    )
    return {
        "kind": "word_drift",
        "reference": {"path": str(reference), "words": len(ref)},
        "candidate": {"path": str(candidate), "words": len(cand)},
        "matched_words": len(matched),
        "untimed_matches": len(matched) - len(timed),
        "median_offset_seconds": float(np.median(offsets)),
        "max_abs_offset_seconds": float(np.abs(offsets).max()),
        "max_offset_word": max(timed, key=lambda m: abs(m["offset_seconds"]))["word"],
        "drift_seconds_per_minute": slope * 60 if slope is not None else None,
        "missing": missing,
        "extra": extra,
        "replaced": replaced,
        "words": matched,
        "limitations": [
            "Words are matched by case/punctuation-insensitive text; ASR wording differences show as replaced, not as timing.",
            "Offsets mix true audio offset with ASR boundary error (often tens of ms); judge a consistent median or a slope, not one word.",
            "Positive offset: the candidate word starts later than the reference word.",
        ],
    }


def _json_argument(value: str):
    """JSON given inline, or as `@path` to a file holding it, so a long list never meets a command-line limit."""
    try:
        return json.loads(Path(value[1:]).read_text() if value.startswith("@") else value)
    except OSError as exc:
        raise argparse.ArgumentTypeError(f"Could not read {value[1:]}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise argparse.ArgumentTypeError(f"Expected JSON: {exc}") from exc


def _roi_argument(value: str):
    try:
        values = [int(v) for v in value.split(",")]
        if len(values) != 4:
            raise ValueError
        return values
    except ValueError as exc:
        raise argparse.ArgumentTypeError("Expected x,y,width,height as four integers.") from exc


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="hf-media evidence", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    inspect = commands.add_parser("probe", help="Inspect streams and all decoded native PTS.")
    inspect.add_argument("source")
    inspect.add_argument("--out", help="Optional JSON output path.")
    for name in ("frames", "clip", "audio", "temporal-scan", "track"):
        command = commands.add_parser(
            name,
            help={
                "frames": "Extract actual native frame PNGs / ROI.",
                "clip": "Map a VFR-preserving native-frame MP4 excerpt.",
                "audio": "Extract a clock-bound PCM waveform.",
                "temporal-scan": "Measure all native frames and suggest evidence windows.",
                "track": "Track an anchored template; preserve loss as missing.",
            }[name],
        )
        command.add_argument("source")
        command.add_argument("--out", required=True, help="New or empty evidence output directory.")
        if name != "audio":
            command.add_argument(
                "--start", type=int, default=0, help="Inclusive native frame index."
            )
            command.add_argument(
                "--end", type=int, help="Exclusive native frame index; default source end."
            )
        if name in ("frames", "clip", "temporal-scan"):
            command.add_argument(
                "--roi", type=_roi_argument, help="x,y,width,height in coded source pixels."
            )
        if name in ("frames", "temporal-scan"):
            command.add_argument(
                "--max-width",
                type=int,
                default=480 if name == "temporal-scan" else None,
                help="Declared preview/analysis width; omit for native frame PNGs.",
            )
        if name == "frames":
            command.add_argument(
                "--indices", type=_json_argument, help="JSON list of explicit native frame indices."
            )
            command.add_argument(
                "--times",
                type=_json_argument,
                help="JSON list of seconds relative to the first video PTS, or @file holding it.",
            )
            command.add_argument(
                "--policy", choices=["nearest", "before", "after"], default="nearest"
            )
            command.add_argument("--step", type=int, default=1)
            command.add_argument("--sheet-columns", type=int, default=0)
        elif name == "clip":
            command.add_argument("--no-audio", action="store_true")
        elif name == "audio":
            command.add_argument("--start", type=float, default=0)
            command.add_argument("--end", type=float)
            command.add_argument("--sample-rate", type=int)
            command.add_argument("--channels", type=int)
        elif name == "temporal-scan":
            command.add_argument("--tiles", type=int, default=4)
            command.add_argument("--change-threshold", type=float)
            command.add_argument("--flash-threshold", type=float)
            command.add_argument("--hold-threshold", type=float, default=0)
            command.add_argument("--max-flash-frames", type=int, default=3)
            command.add_argument("--return-fraction", type=float, default=0.25)
        elif name == "track":
            command.add_argument(
                "--anchors",
                type=_json_argument,
                required=True,
                help='JSON native-frame ROI map, e.g. {"10":[100,200,80,40]}.',
            )
            command.add_argument(
                "--min-score",
                type=float,
                required=True,
                help="Caller-selected NCC acceptance threshold, -1..1.",
            )
            command.add_argument(
                "--search-radius",
                type=int,
                required=True,
                help="Caller-selected source-pixel radius.",
            )
            command.add_argument("--min-peak-margin", type=float, default=0)
            command.add_argument("--cut-frames", type=_json_argument, default=[])
    fit = commands.add_parser(
        "plane", help="Fit a transform with explicit held-out correspondence points."
    )
    fit.add_argument("input_path")
    fit.add_argument("--out", required=True)
    match = commands.add_parser(
        "correspondences",
        help="Match an asset image to a native frame with masks and held-out fit diagnostics.",
    )
    match.add_argument(
        "asset", help="Original still asset image; coordinates use its decoded pixels."
    )
    match.add_argument("source", help="Source video; coordinates use coded source pixels.")
    match.add_argument(
        "--index", type=int, required=True, help="Native presentation-order frame index."
    )
    match.add_argument("--out", required=True, help="New or empty evidence directory.")
    match.add_argument(
        "--tolerance",
        type=float,
        required=True,
        help="Caller-selected target-pixel fit/validation tolerance.",
    )
    match.add_argument(
        "--roi", type=_roi_argument, help="Target x,y,width,height in full source pixels."
    )
    for side in ("asset", "frame"):
        for kind in ("visible", "exclude"):
            match.add_argument(
                f"--{side}-{kind}-mask",
                help=f"Grayscale mask at original {side} canvas size; nonzero pixels mark {kind} regions.",
            )
    match.add_argument(
        "--ratio",
        type=float,
        default=0.72,
        help="Two-neighbor descriptor ratio in both directions; screening heuristic.",
    )
    match.add_argument(
        "--holdout-fraction",
        type=float,
        default=0.25,
        help="Fraction withheld before fitting; at least one, preserving minimal train count.",
    )
    match.add_argument("--seed", type=int, default=1709)
    match.add_argument(
        "--model", choices=["similarity", "affine", "projective"], default="projective"
    )
    match.add_argument("--max-features", type=int, default=6000)
    match.add_argument("--contrast-threshold", type=float, default=0.018)
    pair = commands.add_parser("compare", help="Compare explicitly mapped native frame pairs.")
    pair.add_argument("reference")
    pair.add_argument("candidate")
    pair.add_argument("--out", required=True)
    pair.add_argument(
        "--pairs",
        type=_json_argument,
        required=True,
        help="JSON [[reference_index,candidate_index],...].",
    )
    pair.add_argument("--roi", type=_roi_argument)
    pair.add_argument(
        "--regions",
        type=_json_argument,
        help='JSON {"name":[x,y,w,h] or {"box":[x,y,w,h],"ink":"dark|light"},...} in coded source '
        "pixels: per-region sharpness, color and ink box.",
    )
    seam = commands.add_parser(
        "continuity",
        help="Find jumps, background flicker and extra shapes the source lacks, frame by frame.",
    )
    seam.add_argument("source", help="Reference video.")
    seam.add_argument("candidate", help="Render on the same composition clock.")
    seam.add_argument("--out", required=True, help="New or empty evidence directory.")
    seam.add_argument("--start", type=float, default=0, help="Video-local seconds.")
    seam.add_argument("--end", type=float, help="Exclusive video-local seconds; default end.")
    seam.add_argument("--max-width", type=int, default=CONTINUITY_WIDTH, help="Analysis width.")
    joins = commands.add_parser(
        "join-timing",
        help="Measure how far the picture jumps in source time where generated pieces meet.",
    )
    joins.add_argument("source", help="Reference video.")
    joins.add_argument("candidate", help="Render on the same composition clock.")
    joins.add_argument("--at", type=float, nargs="+", required=True, help="Join times in seconds.")
    joins.add_argument("--max-width", type=int, default=CONTINUITY_WIDTH, help="Analysis width.")
    steps = commands.add_parser(
        "cadence",
        help="Measure typing/reveal/stepped-UI events in a ROI; with --candidate, its lead or lag.",
    )
    steps.add_argument("source")
    steps.add_argument("--roi", type=_roi_argument, required=True, help="x,y,width,height.")
    steps.add_argument("--start", type=float, required=True, help="Video-local seconds.")
    steps.add_argument("--end", type=float, required=True, help="Exclusive video-local seconds.")
    steps.add_argument("--candidate", help="Render to compare over the same seconds.")
    steps.add_argument("--candidate-roi", type=_roi_argument, help="Default: --roi.")
    steps.add_argument(
        "--tolerance",
        type=float,
        default=40,
        help="Ink color distance from the ROI border median.",
    )
    steps.add_argument(
        "--change-threshold", type=float, help="Mean luma change per event; default 25%% of peak."
    )
    steps.add_argument("--max-width", type=int, default=640)
    move = commands.add_parser(
        "motion",
        help="Compare one element's entry, movement or exit: lag, per-property match, shadow.",
    )
    move.add_argument("source")
    move.add_argument("candidate")
    move.add_argument("--roi", type=_roi_argument, required=True, help="x,y,width,height.")
    move.add_argument("--start", type=float, required=True, help="Video-local seconds.")
    move.add_argument("--end", type=float, required=True, help="Exclusive video-local seconds.")
    move.add_argument("--candidate-roi", type=_roi_argument, help="Default: --roi scaled.")
    move.add_argument("--max-width", type=int, default=320)
    move.add_argument("--out", help="Folder for a source | candidate strip of six frames.")
    flows = commands.add_parser(
        "flow",
        help="Compare one element's motion by optical flow: energy, motion over time, path, scale.",
    )
    flows.add_argument("source")
    flows.add_argument("candidate")
    flows.add_argument("--roi", type=_roi_argument, required=True, help="x,y,width,height.")
    flows.add_argument("--start", type=float, required=True, help="Video-local seconds.")
    flows.add_argument("--end", type=float, required=True, help="Exclusive video-local seconds.")
    flows.add_argument("--candidate-roi", type=_roi_argument, help="Default: --roi scaled.")
    flows.add_argument("--candidate-start", type=float, help="Off-clock: the candidate's start.")
    flows.add_argument("--max-width", type=int, default=160)
    tracks = commands.add_parser(
        "flow-track",
        help="Reverse one element's moves from optical flow, as tweens with their closest ease.",
    )
    tracks.add_argument("source")
    tracks.add_argument("--roi", type=_roi_argument, required=True, help="x,y,width,height.")
    tracks.add_argument("--start", type=float, required=True, help="Video-local seconds.")
    tracks.add_argument("--end", type=float, required=True, help="Exclusive video-local seconds.")
    tracks.add_argument("--max-width", type=int, default=320)
    sync = commands.add_parser(
        "av-sync", help="Estimate picture-vs-sound lag from mouth motion and speech energy."
    )
    sync.add_argument("source")
    sync.add_argument("--mouth-roi", type=_roi_argument, required=True, help="x,y,width,height.")
    sync.add_argument("--start", type=float, default=0, help="Video-local seconds.")
    sync.add_argument("--end", type=float, help="Exclusive video-local seconds; default end.")
    sync.add_argument("--max-lag-ms", type=float, default=400)
    face = commands.add_parser(
        "face-size",
        help="Face height as a share of the frame (largest; smallest with --cast), graded on "
        "the median and the last frame, with Video 1's likeness verdict, and that face's box per "
        "sampled frame.",
    )
    face.add_argument("source", help="A still (the shot's first frame) or a take.")
    face.add_argument("--start", type=float, default=0, help="Video-local seconds.")
    face.add_argument("--end", type=float, help="Exclusive video-local seconds; default end.")
    face.add_argument("--samples", type=int, default=12)
    face.add_argument(
        "--cast", action="store_true", help="The shot carries a cast person's likeness."
    )
    drift = commands.add_parser(
        "word-drift",
        help="Align two word-timestamp JSON files and report offsets and word changes.",
    )
    drift.add_argument("reference", help="Words of the selected soundtrack (accepted alignment).")
    drift.add_argument("candidate", help="Words transcribed from the export or take.")
    level = commands.add_parser(
        "loudness", help="Measure integrated loudness and true peak of explicit time windows."
    )
    level.add_argument("source")
    level.add_argument(
        "--windows", type=_json_argument, required=True, help="JSON [[start,end],...] in seconds."
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = vars(parser.parse_args(argv))
    command = args.pop("command")
    output = args.pop("out", None)
    try:
        if command == "probe":
            result = probe(args["source"])
            if output:
                path = Path(output).expanduser().resolve()
                if path.exists():
                    raise EvidenceError(f"Refusing to overwrite existing probe output: {path}")
                _dump(path, result)
                result = {
                    "path": str(path),
                    "source_sha256": result["sha256"],
                    "video": result["video"],
                    "audio": result["audio"],
                }
        else:
            if command == "clip":
                args["include_audio"] = not args.pop("no_audio")
            operations: dict[str, Callable[..., dict]] = {
                "frames": frames,
                "clip": clip,
                "audio": audio,
                "temporal-scan": temporal_scan,
                "track": track,
                "plane": plane,
                "correspondences": correspondences,
                "compare": compare,
                "continuity": continuity,
                "join-timing": join_timing,
                "loudness": loudness,
                "cadence": cadence,
                "motion": motion,
                "flow": flow,
                "flow-track": flow_track,
                "av-sync": av_sync,
                "face-size": face_size,
                "word-drift": word_drift,
            }
            operation = operations[command]
            result = (
                operation(**args)
                if command
                in ("loudness", "cadence", "av-sync", "face-size", "word-drift", "join-timing")
                else operation(output=output, **args)
            )
            if command == "continuity":
                result = {
                    "path": result["manifest_path"],
                    "frames": len(result["frames"]),
                    "events": [
                        {
                            k: e[k]
                            for k in (
                                "kind",
                                "start_frame",
                                "end_frame",
                                "peak_value",
                                "source_value",
                                "sheet",
                            )
                        }
                        for e in result["events"]
                    ],
                }
        print(json.dumps(result, ensure_ascii=False, allow_nan=False))
        return 0
    except (EvidenceError, OSError, KeyError, TypeError, json.JSONDecodeError) as exc:
        print(
            json.dumps(
                {"error": str(exc), "tool": "evidence", "command": command}, ensure_ascii=False
            ),
            file=sys.stderr,
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
