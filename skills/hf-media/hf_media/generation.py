"""Call native media APIs with frozen inputs and recoverable job records.

Keep provider parameters and model choices explicit. Recover unknown submissions
before retrying. Signed result URLs are stored in private response files.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any

if sys.platform == "win32":
    import msvcrt
else:
    import fcntl

API = "https://api.heygen.com"
REVISION = "omni-ref/generation@1"
_PACKAGE_ASSETS = Path(__file__).resolve().parent / "assets/heygen"
_ASSETS = (
    _PACKAGE_ASSETS
    if _PACKAGE_ASSETS.is_dir()
    else Path(__file__).resolve().parents[2] / "assets/heygen"
)
SCHEMA_FILE = _ASSETS / "openapi.snapshot.json"
MODEL_FILE = SCHEMA_FILE.with_name("video-model.contract.json")
IMAGES_FILE = SCHEMA_FILE.with_name("images.contract.json")
TRANSCRIPTION_FILE = SCHEMA_FILE.with_name("transcription.contract.json")
MUSIC_FILE = SCHEMA_FILE.with_name("music.contract.json")
GENERATIONS_FILE = SCHEMA_FILE.with_name("video-generations.contract.json")
# Routes absent from the dated public OpenAPI, described by their own dated contract files.
CONTRACT_FILES = {
    "/v3/models/videos": MODEL_FILE,
    "/v3/images": IMAGES_FILE,
    "/v3/audio/transcriptions": TRANSCRIPTION_FILE,
    "/v3/audio/music": MUSIC_FILE,
    "/v3/video-generations": GENERATIONS_FILE,
}
TERMINAL = {"succeeded", "failed", "cancelled"}
ROUTES: dict[str, dict[str, Any]] = {
    "speech": {"path": "/v3/voices/speech", "mode": "sync", "ids": ["request_id"]},
    "professional-speech": {"path": "/v3/models/audio/tts", "mode": "sync", "ids": ["request_id"]},
    "avatar-create": {
        "path": "/v3/avatars",
        "status": "/v3/avatars/looks/{id}",
        "result_kind": "avatar-create",
        "resource_kind": "avatar-look",
    },
    "avatar-looks": {
        "path": "/v3/avatars/looks",
        "status": "/v3/avatars/looks/{id}",
        "result_kind": "avatar-looks",
        "resource_kind": "avatar-look",
    },
    "professional-voice": {
        "path": "/v3/models/audio/voices",
        "status": "/v3/models/audio/voices/{id}",
        "ids": ["voice_id"],
        "resource_kind": "professional-voice",
    },
    "avatar": {"path": "/v3/videos", "status": "/v3/videos/{id}", "ids": ["video_id", "id"]},
    "video": {
        "path": "/v3/models/videos",
        "status": "/v3/models/videos/{id}",
        "ids": ["video_id", "id"],
    },
    # Hosted vendor models (H3 Max, Seedance 2.5): POST answers pending, GET reads the generation.
    "video-generation": {
        "path": "/v3/video-generations",
        "status": "/v3/video-generations/{id}",
        "ids": ["id"],
        "output_fields": ["video_url"],
        "idempotency": "required",
    },
    "lipsync": {"path": "/v3/lipsyncs", "status": "/v3/lipsyncs/{id}", "ids": ["lipsync_id", "id"]},
    "translation": {
        "path": "/v3/video-translations",
        "status": "/v3/video-translations/{id}",
        "ids": ["video_translation_ids", "video_translation_id", "id"],
    },
    "asset": {"path": "/v3/assets", "mode": "upload", "ids": ["asset_id", "id"]},
    # Generation runs inside the POST, so it can outlast the default timeout. The required
    # Idempotency-Key makes a re-POST after an ambiguous timeout return the original generation.
    "images": {
        "path": "/v3/images",
        "status": "/v3/images/{id}",
        "ids": ["id"],
        "output_fields": [f"images.{i}.url" for i in range(4)],
        "idempotency": "required",
        "idempotent_retry": True,
        "post_timeout": 330,
        # The route answers 400 above this many request-body bytes.
        "max_body": 7_745_879,
    },
    # Transcription and music also run inside the POST, within a 500 s server budget.
    "transcription": {
        "path": "/v3/audio/transcriptions",
        "status": "/v3/audio/transcriptions/{id}",
        "ids": ["id"],
        "json_output": ["id", "model", "language", "duration_seconds", "text", "segments"],
        "idempotency": "required",
        "idempotent_retry": True,
        "post_timeout": 540,
    },
    "music": {
        "path": "/v3/audio/music",
        "status": "/v3/audio/music/{id}",
        "ids": ["id"],
        "output_fields": ["audio_url"],
        "idempotency": "required",
        "idempotent_retry": True,
        "post_timeout": 540,
    },
}
SECRET_KEYS = re.compile(
    r"^(?:authorization|x[-_]api[-_]key|api[-_]key|access[-_]token|refresh[-_]token|password|client[-_]secret|cookie|set[-_]cookie)$",
    re.I,
)


class GenerationError(ValueError):
    """An actionable, public-safe error."""


class APIError(GenerationError):
    def __init__(self, message, *, status=None, ambiguous=False, detail=None):
        super().__init__(message)
        self.status, self.ambiguous, self.detail = status, ambiguous, detail


def stamp():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def canonical(value):
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
    ).encode()


def sha(value):
    return hashlib.sha256(value).hexdigest()


def file_hash(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for part in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(part)
    return h.hexdigest()


def read_json(path):
    return json.loads(Path(path).read_text())


def write_json(path, value, *, private=False):
    """Atomic replace; fsync before rename prevents partial receipts on interruption."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600 if private else 0o644)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(
                json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False).encode() + b"\n"
            )
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def require(condition, message):
    if not condition:
        raise GenerationError(message)


def reject_credentials(value):
    if isinstance(value, dict):
        for key, item in value.items():
            require(
                not SECRET_KEYS.match(key),
                "Credentials belong in authentication, not a request body",
            )
            reject_credentials(item)
    elif isinstance(value, list):
        for item in value:
            reject_credentials(item)


def redact(value, secrets=()):
    if isinstance(value, dict):
        if value.get("type") == "base64" and isinstance(value.get("data"), str):
            return {
                **{k: redact(v, secrets) for k, v in value.items() if k != "data"},
                "data": {
                    "redacted": True,
                    "sha256": sha(value["data"].encode()),
                    "encoded_length": len(value["data"]),
                },
            }
        return {
            k: "[REDACTED]" if SECRET_KEYS.match(k) else redact(v, secrets)
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [redact(v, secrets) for v in value]
    if isinstance(value, str):
        if value.startswith("data:"):
            return {"redacted": True, "sha256": sha(value.encode()), "encoded_length": len(value)}
        for secret in secrets:
            if secret:
                value = value.replace(secret, "[REDACTED]")

        # Also handles a signed URL embedded in a provider error sentence.
        def url_replace(match):
            url = urllib.parse.urlsplit(match.group(0))
            return urllib.parse.urlunsplit(
                (url.scheme, url.hostname or "", url.path, "REDACTED" if url.query else "", "")
            )

        return re.sub(r"https?://[^\s\"<>]+", url_replace, value, flags=re.I)
    return value


def refuse_without_host_payer(env=None):
    """A host that pays only through its own profile sets HF_MEDIA_HOST_PAYS_ONLY to the words that say how to get one."""
    env = os.environ if env is None else env
    if env.get("HF_MEDIA_HOST_PAYS_ONLY"):
        raise GenerationError(env["HF_MEDIA_HOST_PAYS_ONLY"])


def credential(*, environ=None, home=None, name="HEYGEN_API_KEY"):
    """The one reader of the key a call pays with: the `name` variable (a HeyGen key also from HYPERFRAMES_API_KEY,
    then ~/.heygen/credentials; an OAuth login there is ignored)."""
    env = os.environ if environ is None else environ
    refuse_without_host_payer(env)
    if name != "HEYGEN_API_KEY":
        require(env.get(name), f"Set {name} in the host environment")
        return {"X-Api-Key": env[name]}, {"available": True, "source": name, "method": "api_key"}
    for name in ("HEYGEN_API_KEY", "HYPERFRAMES_API_KEY"):
        if env.get(name):
            return {"X-Api-Key": env[name]}, {
                "available": True,
                "source": name,
                "method": "api_key",
            }
    path = (
        Path(env.get("HEYGEN_CONFIG_DIR", str(Path(home or Path.home()) / ".heygen")))
        / "credentials"
    )
    try:
        raw = path.read_text().strip()
        data = json.loads(raw) if raw.startswith("{") else {"api_key": raw}
    except (OSError, ValueError):
        raise GenerationError(
            "No usable HeyGen credential: set HEYGEN_API_KEY or use the existing HyperFrames/HeyGen CLI login"
        ) from None
    require(isinstance(data, dict), "HeyGen credentials file has an invalid shape")
    # API key only: HeyGen images, music and transcription refuse OAuth tokens (403 api_key_required).
    if isinstance(data.get("api_key"), str) and data["api_key"]:
        return {"X-Api-Key": data["api_key"]}, {
            "available": True,
            "source": "heygen_credentials",
            "method": "api_key",
        }
    raise GenerationError(
        "No HeyGen API key: set HEYGEN_API_KEY or save a key with the HeyGen CLI; an OAuth login is not used"
    )


def default_client():
    """HeyGen client from OMNI_REF_PROVIDER_CONFIG when a host profile is set, else the CLI contract.

    A profile never falls back to HEYGEN_API_KEY or ~/.heygen: the host chose who pays.
    """
    if os.environ.get("OMNI_REF_PROVIDER_CONFIG"):
        from .provider import client_for

        return client_for("heygen")
    return Client()


def credential_state():
    """Who pays for HeyGen calls, never the secret. Under a host profile the host answers live (GET /v3/users/me), so
    a missing or refused key reports the host's own instruction, e.g. where to add a key."""
    if not os.environ.get("OMNI_REF_PROVIDER_CONFIG"):
        return credential()[1]
    try:
        default_client().request("GET", "/v3/users/me")
    except GenerationError as exc:
        detail = getattr(exc, "detail", None)
        error = detail.get("error") if isinstance(detail, dict) else None
        error = error if isinstance(error, dict) else {}
        return {
            "available": False,
            "source": "host_profile",
            "status": getattr(exc, "status", None),
            "code": error.get("code"),
            "message": error.get("message") or str(exc),
        }
    return {"available": True, "source": "host_profile"}


def default_endpoint():
    """The origin and host profile name a new job is frozen with."""
    if os.environ.get("OMNI_REF_PROVIDER_CONFIG"):
        from .provider import configuration

        entry = configuration()["heygen"]
        return entry["base_url"], entry["profile"]
    return API, None


def validate_path(path):
    parsed = urllib.parse.urlsplit(path)
    require(
        path.startswith(("/v3/", "/v2/", "/v1/"))
        and not parsed.netloc
        and not parsed.scheme
        and not parsed.fragment
        and "\\" not in path
        and not any(ord(c) < 32 for c in path),
        "Use a relative native API path, not a URL",
    )
    require(
        not any(part in (".", "..") for part in urllib.parse.unquote(parsed.path).split("/")),
        "API path cannot contain traversal segments",
    )
    require(
        not any(SECRET_KEYS.match(key) for key, _ in urllib.parse.parse_qsl(parsed.query)),
        "Authentication values must not appear in API query parameters",
    )
    return path


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def loopback_proxy(base_url):
    """A plain-HTTP host proxy on this machine (Desktop attaches the real key itself)."""
    origin = urllib.parse.urlsplit(base_url)
    return origin.scheme == "http" and origin.hostname in ("127.0.0.1", "localhost", "::1")


class Client:
    def __init__(
        self, *, headers=None, opener=None, timeout=45, base_url=API, provider="heygen", profile=None
    ):
        require(isinstance(base_url, str), "Provider base_url must be an HTTPS origin")
        origin = urllib.parse.urlsplit(base_url)
        require(
            (origin.scheme == "https" or loopback_proxy(base_url))
            and origin.hostname
            and not origin.username
            and not origin.password
            and not origin.query
            and not origin.fragment
            and origin.path in ("", "/"),
            "Provider base_url must be an HTTPS origin or a loopback HTTP host proxy",
        )
        self.base_url, self.provider, self.profile = base_url.rstrip("/"), provider, profile
        require(
            0 < timeout <= 60,
            "HTTP timeout must be between 0 and 60 seconds; recover longer operations by job ID",
        )
        if headers is None:
            require(provider == "heygen", "Supply authentication for this provider explicitly")
            headers, self.credential_info = credential()
        else:
            self.credential_info = {
                "available": bool(headers),
                "source": "supplied",
                "method": "custom",
            }
        self.headers = dict(headers)
        self.timeout = timeout
        self.opener = opener or urllib.request.build_opener(NoRedirect())
        self.secrets = tuple(
            v.removeprefix("Bearer ") for k, v in headers.items() if SECRET_KEYS.match(k)
        )

    def request(
        self,
        method,
        path,
        body=None,
        *,
        data=None,
        content_type=None,
        idempotency_key=None,
        timeout=None,
        submit_timeout=None,
    ):
        validate_path(path)
        require(method in ("GET", "POST"), "This generation transport exposes only GET and POST")
        headers = {
            **self.headers,
            "Accept": "application/json",
            # Cloudflare in front of api-canary refuses urllib's default User-Agent (error 1010).
            "User-Agent": f"{REVISION} (python-urllib)",
        }
        if self.provider == "heygen":
            headers["X-HeyGen-Client-Source"] = "omni-ref"
        if body is not None:
            reject_credentials(body)
            data, content_type = canonical(body), "application/json"
        if content_type:
            headers["Content-Type"] = content_type
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        request = urllib.request.Request(
            self.base_url + path, data=data, headers=headers, method=method
        )
        requested_at = stamp()
        started = time.monotonic()
        try:
            with self.opener.open(
                request,
                timeout=submit_timeout
                or (min(self.timeout, timeout) if timeout is not None else self.timeout),
            ) as response:
                raw = response.read()
                received_at = stamp()
                elapsed = time.monotonic() - started
                try:
                    result = json.loads(raw)
                except (ValueError, UnicodeDecodeError):
                    raise APIError(
                        f"{self.provider} returned invalid JSON; retain this attempt",
                        ambiguous=method == "POST",
                    ) from None
                require(
                    isinstance(result, (dict, list)),
                    f"{self.provider} returned an unexpected JSON value",
                )
                return {
                    "body": result,
                    "request_id": response.headers.get("X-Request-Id"),
                    "http_status": response.status,
                    "requested_at": requested_at,
                    "received_at": received_at,
                    "http_elapsed_seconds": elapsed,
                }
        except urllib.error.HTTPError as exc:
            detail = None
            try:
                detail = redact(json.loads(exc.read()), self.secrets)
            except (OSError, ValueError, UnicodeDecodeError):
                pass
            finally:
                exc.close()
            raise APIError(
                f"{self.provider} HTTP {exc.code}; inspect the redacted response detail",
                status=exc.code,
                ambiguous=method == "POST" and (exc.code >= 500 or exc.code in (408, 409)),
                detail=detail,
            ) from None
        except (OSError, TimeoutError) as exc:
            raise APIError(
                f"{self.provider} transport {type(exc).__name__}; no automatic submission retry",
                ambiguous=method == "POST",
            ) from None

    def json(self, path, body=None, *, idempotency_key=None):
        return self.request(
            "POST" if body is not None else "GET", path, body, idempotency_key=idempotency_key
        )["body"]


def schema_document():
    require(
        SCHEMA_FILE.is_file(),
        "Native schema assets are missing; reinstall the complete omni-ref skill/package including assets/heygen",
    )
    return read_json(SCHEMA_FILE)


def resolve_ref(spec, node):
    while isinstance(node, dict) and "$ref" in node:
        ref = node["$ref"]
        require(ref.startswith("#/"), "Only local schema references are supported")
        node = spec
        for key in ref[2:].split("/"):
            node = node[key.replace("~1", "/").replace("~0", "~")]
    return node


def request_schema(path, method="POST", *, spec=None):
    spec = spec or schema_document()
    if path in CONTRACT_FILES and method == "POST" and path not in spec.get("paths", {}):
        model = read_json(CONTRACT_FILES[path])
        return {
            "schema": model["request_schema"],
            "components": {},
            "provenance": model["provenance"],
        }
    operation = spec.get("paths", {}).get(path, {}).get(method.lower())
    require(
        operation is not None,
        "Route is absent from the dated schema; use raw mode with an explicit status path, or provide current OpenAPI",
    )
    return {
        "operation": operation,
        "schema": operation.get("requestBody", {})
        .get("content", {})
        .get("application/json", {})
        .get("schema"),
        "components": spec.get("components", {}),
        "provenance": spec.get("x-omni-ref-provenance", {}),
    }


def catalog():
    spec = schema_document()
    return {
        "adapter": REVISION,
        "schema_source": spec["x-omni-ref-provenance"],
        "routes": [
            {
                "name": name,
                **route,
                "capability_check": "Query actual workspace voices/looks; schema presence alone does not imply compatibility",
            }
            for name, route in ROUTES.items()
        ],
        "managed_scope": "Only listed routes have managed result/status contracts; schema availability alone does not establish a managed operation",
        "read_only_discovery": [
            "/v3/voices?limit=20",
            "/v3/voices/{voice_id}",
            "/v3/avatars/looks/{look_id}",
            "/v3/avatars/look-templates",
            "/v3/models/audio/voices",
            "/v3/models/audio/voices/{voice_id}",
            "/v3/video-translations/languages",
        ],
        "native_escape_hatch": "prepare(..., path='/v3/...', raw=True, status_path='/v3/.../{id}') then submit; raw request schema is not locally validated",
    }


def _schema_errors(value, schema, spec, path="$"):
    """Small structural validator for the native JSON Schema vocabulary used here.

    Semantic model/input restrictions and deployment availability remain provider-owned.
    """
    schema = resolve_ref(spec, schema)
    if not isinstance(schema, dict):
        return []
    errors = []
    for keyword in ("anyOf", "oneOf"):
        if keyword in schema:
            matches = sum(
                not _schema_errors(value, branch, spec, path) for branch in schema[keyword]
            )
            if matches == 0 or (keyword == "oneOf" and matches != 1):
                return [
                    f"{path} must match {'one' if keyword == 'oneOf' else 'a'} native {keyword} branch"
                ]
    for child in schema.get("allOf", []):
        errors.extend(_schema_errors(value, child, spec, path))
    if "const" in schema and value != schema["const"]:
        errors.append(f"{path} has an incompatible discriminator")
    if "enum" in schema and value not in schema["enum"]:
        errors.append(f"{path} is outside the native enum")
    kinds = schema.get("type")
    kinds = [kinds] if isinstance(kinds, str) else kinds
    types = {
        "object": isinstance(value, dict),
        "array": isinstance(value, list),
        "string": isinstance(value, str),
        "number": type(value) in (int, float),
        "integer": type(value) is int,
        "boolean": type(value) is bool,
        "null": value is None,
    }
    if kinds and not any(types.get(kind, False) for kind in kinds):
        return errors + [f"{path} has the wrong native JSON type"]
    if isinstance(value, dict):
        for key in schema.get("required", []):
            if key not in value:
                errors.append(f"{path}.{key} is required")
        props = schema.get("properties", {})
        for key, item in value.items():
            if key in props:
                errors.extend(_schema_errors(item, props[key], spec, path + "." + key))
            elif schema.get("additionalProperties") is False:
                errors.append(f"{path}.{key} is not a native field")
    if isinstance(value, list):
        for key, predicate in (
            ("minItems", len(value) < schema.get("minItems", 0)),
            ("maxItems", len(value) > schema.get("maxItems", float("inf"))),
        ):
            if predicate:
                errors.append(f"{path} violates {key}")
        if "items" in schema:
            for i, item in enumerate(value):
                errors.extend(_schema_errors(item, schema["items"], spec, f"{path}[{i}]"))
    if isinstance(value, str):
        if len(value) < schema.get("minLength", 0) or len(value) > schema.get(
            "maxLength", float("inf")
        ):
            errors.append(f"{path} violates native text length")
    if type(value) in (int, float):
        if value < schema.get("minimum", -float("inf")) or value > schema.get(
            "maximum", float("inf")
        ):
            errors.append(f"{path} violates native numeric bounds")
    return errors


def validate_request(path, payload, *, raw=False):
    validate_path(path)
    require(isinstance(payload, dict), "Native JSON payload must be an object")
    reject_credentials(payload)
    canonical(payload)  # refuses NaN/Infinity
    if raw:
        return {"status": "unchecked-native", "remote_compatibility": "unknown"}
    contract = request_schema(path)
    schema = contract.get("schema")
    require(
        schema is not None, "This operation is not a JSON generation route; use upload for assets"
    )
    errors = _schema_errors(payload, schema, {"components": contract["components"]})
    if path == "/v3/models/videos":
        mode = payload.get("mode", "reference_to_video")
        if mode == "image_to_video" and not payload.get("image"):
            errors.append("$.image is required for image_to_video")
        if mode == "reference_to_video" and not (
            payload.get("reference_images") or payload.get("reference_videos")
        ):
            errors.append(
                "reference_to_video needs a reference image or video; audio alone is insufficient"
            )
        if mode != "reference_to_video" and any(
            payload.get(k) for k in ("reference_images", "reference_videos", "reference_audio")
        ):
            errors.append("Reference lists require reference_to_video")
        if mode != "image_to_video" and payload.get("image"):
            errors.append("image requires image_to_video")
        if (
            sum(
                len(payload.get(k) or [])
                for k in ("reference_images", "reference_videos", "reference_audio")
            )
            > 12
        ):
            errors.append("At most 12 combined references are supported")
        if mode == "text_to_video" and payload.get("aspect_ratio") == "adaptive":
            errors.append("text_to_video has no adaptive source aspect ratio")
        if (
            payload.get("resolution") == "2k"
            and mode != "image_to_video"
            and payload.get("aspect_ratio") not in ("16:9", "9:16")
        ):
            errors.append(
                "2k renders only 16:9 or 9:16; set aspect_ratio to one of them "
                "(adaptive resolves at 480p and 768p only)"
            )
    if path == "/v3/video-generations":
        if payload.get("middle_frame") is not None:
            if payload.get("first_frame") is None or payload.get("end_frame") is None:
                errors.append("middle_frame needs first_frame and end_frame")
            if payload.get("resolution") not in ("480p", "768p"):
                errors.append("middle_frame needs resolution 480p or 768p")
            if payload.get("middle_frame_time") is None:
                errors.append("middle_frame needs middle_frame_time")
        refs = [
            (key, i, ref)
            for key in ("reference_images", "reference_videos", "reference_audio")
            for i, ref in enumerate(payload.get(key) or [])
        ]
        if payload.get("model") == "minimax-h3-max" and len(refs) > 12:
            errors.append("minimax-h3-max takes at most 12 reference files")
        frames = [(k, None, payload.get(k)) for k in ("first_frame", "end_frame", "middle_frame")]
        for key, i, ref in refs + frames:
            if isinstance(ref, dict) and ref.get("type") == "url":
                if not str(ref.get("url", "")).startswith("https://"):
                    where = key if i is None else f"{key}[{i}]"
                    errors.append(f"$.{where}.url needs HTTPS; upload local files as assets")
    if path == "/v3/images":
        refs = payload.get("reference_images") or []
        if payload.get("model") == "nano-banana-2" and len(refs) > 14:
            errors.append("nano-banana-2 accepts at most 14 reference images")
        if payload.get("model") == "gpt-image-2.5" and payload.get("aspect_ratio") in (
            "3:2",
            "2:3",
            "21:9",
        ):
            errors.append("gpt-image-2.5 takes only 1:1, 16:9, 9:16, 4:3 or 3:4")
        for i, ref in enumerate(refs):
            if isinstance(ref, dict) and ref.get("type") == "url":
                if not str(ref.get("url", "")).startswith("https://"):
                    errors.append(
                        f"$.reference_images[{i}].url needs HTTPS; upload local files as assets or base64"
                    )
    if path == "/v3/audio/music" and payload.get("lyrics") and payload.get("instrumental"):
        errors.append("lyrics are sung, so they cannot go with instrumental: true")
    if path == "/v3/audio/transcriptions":
        audio = payload.get("audio")
        if isinstance(audio, dict) and audio.get("type") == "url":
            if not str(audio.get("url", "")).startswith("https://"):
                errors.append("$.audio.url needs HTTPS; upload local files as assets or base64")
    if path == "/v3/videos" and payload.get("type") in ("avatar", "image"):
        if sum(bool(payload.get(k)) for k in ("script", "audio_url", "audio_asset_id")) != 1:
            errors.append(
                "Spoken avatar/image video requires exactly one of script, audio_url, audio_asset_id"
            )
        if payload.get("type") == "image" and payload.get("script") and not payload.get("voice_id"):
            errors.append("Image + script requires a voice_id")
    if path == "/v3/videos" and payload.get("type") == "cinematic_avatar":
        looks = payload.get("avatar_id")
        if isinstance(looks, list) and not 1 <= len(looks) <= 3:
            errors.append("Cinematic Avatar requires 1-3 avatar look IDs")
    if path == "/v3/models/audio/voices" and not payload.get("voice_id"):
        if not payload.get("name") or not payload.get("language"):
            errors.append(
                "New professional voices require name and language; retraining uses voice_id"
            )
    require(not errors, "; ".join(errors))
    return {
        "status": "structurally-valid",
        "remote_compatibility": "unknown",
        "schema_source": contract["provenance"],
        "note": "Structural validation is not workspace/input compatibility or creative acceptance",
    }


def data_object(response):
    data = response.get("data", response) if isinstance(response, dict) else response
    return data if isinstance(data, dict) else {}


def query(path, *, client=None, out=None):
    response = (client or default_client()).request("GET", path)
    result = {
        "schema": "omni-ref/discovery@1",
        "path": path,
        "checked_at": stamp(),
        "response": redact(response["body"]),
        "response_sha256": sha(canonical(response["body"])),
        "provider_request_id": response.get("request_id"),
    }
    if out:
        write_json(out, result)
    return result


def preflight(path, payload, *, client=None):
    """Read deployment discovery where it gives an explicit compatibility answer."""
    validation = validate_request(path, payload)
    _route(path)
    result = {"validation": validation, "state": "unknown", "checks": []}
    client = client or default_client()
    if path == "/v3/voices/speech":
        response = client.json("/v3/voices/" + urllib.parse.quote(payload["voice_id"], safe=""))
        voice = data_object(response)
        available = voice.get("available_engines")
        requested = payload.get("engine")
        result["checks"].append({"kind": "voice", "response": redact(response)})
        if requested and isinstance(available, list):
            names = [x if isinstance(x, str) else x.get("engine", x.get("id")) for x in available]
            result["state"] = "compatible" if requested in names else "unsupported"
        result["note"] = (
            "Language/locale and final synthesis remain server-validated; no silent engine substitution"
        )
    elif path == "/v3/videos" and payload.get("type") == "avatar":
        response = client.json(
            "/v3/avatars/looks/" + urllib.parse.quote(payload["avatar_id"], safe="")
        )
        look = data_object(response)
        engines = look.get("supported_api_engines")
        requested = payload.get("engine", {})
        requested = requested.get("type") if isinstance(requested, dict) else requested
        result["checks"].append({"kind": "look", "response": redact(response)})
        if requested and isinstance(engines, list):
            result["state"] = "compatible" if requested in engines else "unsupported"
    elif path == "/v3/models/audio/tts":
        response = client.json(
            "/v3/models/audio/voices/" + urllib.parse.quote(payload["voice_id"], safe="")
        )
        training = data_object(response).get("status")
        result["checks"].append({"kind": "professional-voice", "response": redact(response)})
        if training == "ACTIVE":
            result["state"] = "compatible"
        elif training in ("PENDING", "FAILED"):
            result["state"] = "not-ready"
        result["note"] = (
            "Professional voice inference requires ACTIVE; this check does not train or retrain the voice"
        )
    return result


@contextmanager
def locked(directory):
    root = Path(directory).resolve()
    require(root.is_dir(), "Job directory does not exist")
    with (root / ".lock").open("a") as lock:
        try:
            _lock_file(lock, exclusive=True)
        except (BlockingIOError, PermissionError):
            raise GenerationError(
                "Another process owns this job; inspect it before retrying"
            ) from None
        try:
            yield root
        finally:
            _lock_file(lock, exclusive=False)


def _lock_file(lock, *, exclusive):
    # Windows has no flock; msvcrt locks the file's first byte, refusing a second holder with PermissionError.
    if sys.platform == "win32":
        lock.seek(0)
        msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK if exclusive else msvcrt.LK_UNLCK, 1)
    else:
        fcntl.flock(lock.fileno(), (fcntl.LOCK_EX | fcntl.LOCK_NB) if exclusive else fcntl.LOCK_UN)


def update(root, record, *, event=None, **changes):
    record.update(changes)
    record["updated_at"] = stamp()
    write_json(root / "job.json", record)
    _append_event(root, record, event or record["state"], at=record["updated_at"])
    return record


def _append_event(root, record, event, *, at=None, **facts):
    entry = {
        "at": at or stamp(),
        "event": event,
        "state": record["state"],
        "provider_ids": [r["id"] for r in record.get("resources", [])],
        **facts,
    }
    with (root / "events.jsonl").open("a") as stream:
        stream.write(json.dumps(entry, ensure_ascii=False) + "\n")
        stream.flush()
        os.fsync(stream.fileno())


def _observe_terminal(record, state, at):
    """First local observation, not the provider's actual completion time."""
    if state in TERMINAL:
        record.setdefault("terminal_observed_at", at)
        record.setdefault("terminal_observed_state", state)


def _route(path, *, raw=False, status_path=None):
    route = next((dict(value) for value in ROUTES.values() if value["path"] == path), {})
    if not route:
        require(
            raw,
            "No managed job contract for this route. Inspect its schema and use native "
            "Client.request with explicit result handling. "
            "Custom asynchronous jobs require raw=True/--raw and a verified status_path/--status-path",
        )
        require(
            status_path,
            "Raw asynchronous routes require an explicit native status_path containing {id}",
        )
        route = {"path": path, "ids": ["id", "job_id", "video_id", "request_id"]}
    if status_path:
        validate_path(status_path)
        require("{id}" in status_path, "Status path must contain {id}")
        route["status"] = status_path
    return route


def prepare(
    directory,
    path,
    payload,
    *,
    inputs=(),
    raw=False,
    status_path=None,
    idempotency_key=None,
    upload_file=None,
    provider="heygen",
    endpoint=None,
    profile=None,
    route_contract=None,
    validation=None,
):
    """Freeze native request hash and public redaction, without submitting anything.

    The original payload is supplied again at submit and must hash-identically match.
    No recoverable API credential or signed request URL is written to the job directory.
    """
    # Every job is frozen here with who pays for it: a chat that cannot pay freezes none, so none blocks a later one.
    refuse_without_host_payer()
    path = validate_path(path)
    if endpoint is None:
        endpoint, profile = default_endpoint()
    reject_credentials(payload)
    if validation is None:
        validation = (
            {"status": "upload"} if upload_file else validate_request(path, payload, raw=raw)
        )
    route = route_contract or _route(path, raw=raw, status_path=status_path)
    if route.get("max_body"):
        size = len(json.dumps(payload, ensure_ascii=False).encode())
        require(
            size <= route["max_body"],
            f"Request body is {size:,} bytes; {path} accepts at most {route['max_body']:,}. Send large "
            "references as uploaded asset_id or HTTPS url, or downscale them; nothing was submitted",
        )
    if route.get("idempotency") == "required" and not idempotency_key:
        idempotency_key = "omni-ref-" + uuid.uuid4().hex
    facts = []
    for source in [*inputs, *([upload_file] if upload_file else [])]:
        source = Path(source).resolve()
        require(source.is_file(), "Declared generation input is missing")
        fact = {"path": str(source), "sha256": file_hash(source), "bytes": source.stat().st_size}
        if fact not in facts:
            facts.append(fact)
    if idempotency_key:
        require(
            isinstance(idempotency_key, str)
            and 1 <= len(idempotency_key) <= 256
            and not any(ord(c) < 32 for c in idempotency_key),
            "Invalid explicit Idempotency-Key",
        )
    root = Path(directory).resolve()
    root.mkdir(parents=True, exist_ok=False)
    request_hash = sha(canonical(payload))
    write_json(root / "request.redacted.json", redact(payload))
    adapter_source = Path(__file__).read_bytes()
    (root / "adapter.source.py").write_bytes(adapter_source)
    record = {
        "schema": "omni-ref/heygen-job@1" if provider == "heygen" else "omni-ref/provider-job@1",
        "job_id": root.name,
        "provider": provider,
        "endpoint": endpoint,
        "profile": profile,
        "route": path,
        "adapter_revision": REVISION,
        "adapter_sha256": sha(adapter_source),
        "adapter_source_path": "adapter.source.py",
        "created_at": stamp(),
        "state": "prepared",
        "request_sha256": request_hash,
        "request_path": "request.redacted.json",
        "inputs": facts,
        "resources": [],
        "outputs": [],
        "request_fingerprint": sha(
            canonical(
                {
                    "route": path,
                    "provider": provider,
                    "endpoint": endpoint,
                    "payload_sha256": request_hash,
                    "inputs": facts,
                    "adapter_sha256": sha(adapter_source),
                }
            )
        ),
        "engine_requested": redact(payload.get("engine")),
        "model_requested": redact(payload.get("model")),
        "engine_actual": None,
        "model_actual": None,
        "route_contract": route,
        "validation": validation,
        "idempotency_key": idempotency_key,
        "acceptance": "not-reviewed",
    }
    if upload_file:
        record["upload_file"] = str(Path(upload_file).resolve())
    return update(root, record)


def inspect_job(directory):
    with locked(directory) as root:
        record = read_json(root / "job.json")
        # A process may have died after the provider accepted its POST.
        if record["state"] == "submitting":
            update(root, record, state="submission-unknown", event="interrupted-submit")
        return record


def _response(root, record, response, name):
    body = response["body"]
    write_json(root / (name + ".private.json"), body, private=True)
    write_json(root / (name + ".redacted.json"), redact(body))
    record["last_response_path"] = name + ".redacted.json"
    record["last_response_sha256"] = sha(canonical(body))
    record["last_private_response"] = name + ".private.json"
    record["last_response_received_at"] = response.get("received_at") or stamp()
    if response.get("request_id"):
        record["provider_request_id"] = response["request_id"]
    data = data_object(body)
    if data.get("engine") is not None:
        record["engine_actual"] = redact(data["engine"])
        record["engine_source"] = "provider-response"
    if data.get("model") is not None:
        record["model_actual"] = redact(data["model"])
        record["model_source"] = "provider-response"
    # Video 1 reports the seed it used even when the request sent none; replay() needs it.
    if type(data.get("seed")) is int:
        record["seed"] = data["seed"]
    _append_event(
        root,
        record,
        "http-response",
        at=record["last_response_received_at"],
        operation=name,
        http_status=response.get("http_status"),
        provider_request_id=response.get("request_id"),
        requested_at=response.get("requested_at"),
        received_at=record["last_response_received_at"],
        http_elapsed_seconds=response.get("http_elapsed_seconds"),
    )
    return data


def _error(root, record, exc, event):
    error = {
        "type": type(exc).__name__,
        "http_status": getattr(exc, "status", None),
        "detail": getattr(exc, "detail", None),
    }
    record["last_error"] = error
    write_json(root / f"{event}.error.json", error)


def _state(value, kind=None):
    if kind == "professional-voice" and str(value).upper() == "ACTIVE":
        return "succeeded"
    if kind in ("avatar-look", "avatar-group") and value == "pending_consent":
        return "needs-input"
    return {
        "pending": "submitted",
        "queued": "submitted",
        "in_queue": "submitted",
        "in_progress": "running",
        "processing": "running",
        "running": "running",
        "waiting": "submitted",
        "completed": "succeeded",
        "succeeded": "succeeded",
        "success": "succeeded",
        "failed": "failed",
        "error": "failed",
        "cancelled": "cancelled",
        "canceled": "cancelled",
    }.get(str(value).lower(), "provider-unknown")


def _aggregate_state(resources):
    states = [resource["state"] for resource in resources]
    if not states:
        return "submission-unknown"
    if all(state == "succeeded" for state in states):
        return "succeeded"
    if all(state in TERMINAL for state in states):
        return "failed" if "failed" in states else "cancelled"
    if "needs-input" in states:
        return "needs-input"
    if "provider-unknown" in states:
        return "provider-unknown"
    return (
        "running"
        if "running" in states or any(state in TERMINAL for state in states)
        else "submitted"
    )


def _submitted_resources(data, route):
    result_kind = route.get("result_kind")
    if result_kind == "avatar-create":
        resources = []
        for key, kind, status_path in (
            ("avatar_item", "avatar-look", "/v3/avatars/looks/{id}"),
            ("avatar_group", "avatar-group", "/v3/avatars/{id}"),
        ):
            item = data.get(key)
            if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not item["id"]:
                continue
            resources.append(
                {
                    "id": item["id"],
                    "kind": kind,
                    "status_path": status_path,
                    "state": _state(item["status"], kind) if item.get("status") else "submitted",
                    "provider_status": item.get("status"),
                    "response_data_key": key,
                }
            )
        return resources
    if result_kind == "avatar-looks":
        looks = data.get("looks")
        if not isinstance(looks, list) or not all(
            isinstance(item, dict) and isinstance(item.get("id"), str) and item["id"]
            for item in looks
        ):
            return []
        return [
            {
                "id": item["id"],
                "kind": "avatar-look",
                "group_id": data.get("group_id"),
                "state": "submitted",
            }
            for item in looks
        ]
    return [
        {
            "id": rid,
            "state": "submitted",
            **({"kind": route["resource_kind"]} if route.get("resource_kind") else {}),
        }
        for rid in _resource_ids(data, route)
    ]


def _resource_ids(data, route):
    for field in route.get("ids", ["id"]):
        values = data.get(field)
        if values:
            values = values if isinstance(values, list) else [values]
            if all(isinstance(v, str) and v for v in values):
                return values
    return []


def _check_client(record, client):
    base_url, endpoint = getattr(client, "base_url", API), record.get("endpoint", API)
    same = base_url == endpoint
    # A named host profile keeps its jobs across restarts, when its loopback proxy comes back on a new port.
    if record.get("profile"):
        same = getattr(client, "profile", None) == record["profile"] and (
            same or (loopback_proxy(base_url) and loopback_proxy(endpoint))
        )
    require(
        getattr(client, "provider", "heygen") == record["provider"] and same,
        "Provider or endpoint differs from the frozen job; use its original profile",
    )


def submit(directory, payload, *, client=None):
    """One POST only. A known/unknown previous submission cannot be submitted again."""
    client = client or default_client()
    with locked(directory) as root:
        record = read_json(root / "job.json")
        _check_client(record, client)
        contract = record.get("route_contract", {})
        deduplicated_retry = (
            record["state"] == "submission-unknown"
            and record.get("idempotency_key")
            and contract.get("idempotent_retry")
        )
        require(
            record["state"] == "prepared" or deduplicated_retry,
            "Job was already attempted; query/recover it or prepare a separately identified candidate",
        )
        require(
            contract.get("mode") in ("sync", "upload") or contract.get("status"),
            "Prepared job has no managed result/status contract; no request was submitted. "
            "Inspect the native schema and use Client.request with explicit result handling",
        )
        require(
            sha(canonical(payload)) == record["request_sha256"],
            "Payload differs from the frozen request; prepare a new job",
        )
        for fact in record["inputs"]:
            require(
                Path(fact["path"]).is_file() and file_hash(fact["path"]) == fact["sha256"],
                "Generation input changed since prepare; prepare a new job",
            )
        upload_bytes = b""
        if record.get("upload_file"):
            upload_bytes = Path(record["upload_file"]).read_bytes()
            expected = next(
                fact["sha256"] for fact in record["inputs"] if fact["path"] == record["upload_file"]
            )
            require(
                sha(upload_bytes) == expected,
                "Upload changed while reading; no request was submitted",
            )
        update(root, record, state="submitting", submitted_at=stamp())
        try:
            if record.get("upload_file"):
                source = Path(record["upload_file"])
                boundary = "omniref" + uuid.uuid4().hex
                filename = re.sub(r"[^a-zA-Z0-9._-]", "_", source.name)
                mime = mimetypes.guess_type(source.name)[0] or "application/octet-stream"
                raw = (
                    f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\nContent-Type: {mime}\r\n\r\n'.encode()
                    + upload_bytes
                    + f"\r\n--{boundary}--\r\n".encode()
                )
                response = client.request(
                    "POST",
                    record["route"],
                    data=raw,
                    content_type=f"multipart/form-data; boundary={boundary}",
                )
            else:
                response = client.request(
                    "POST",
                    record["route"],
                    payload,
                    idempotency_key=record.get("idempotency_key"),
                    submit_timeout=contract.get("post_timeout"),
                )
            data = _response(root, record, response, "submit")
            observed_at = record["last_response_received_at"]
            resources = _submitted_resources(data, record["route_contract"])
            mode = record["route_contract"].get("mode")
            record["resources"] = resources
            for resource in resources:
                resource.update(
                    response_path="submit.private.json",
                    response_sha256=record["last_response_sha256"],
                )
                _observe_terminal(resource, resource["state"], observed_at)
            if mode == "sync" and data.get("audio_url"):
                for resource in record["resources"]:
                    resource["state"] = "succeeded"
                    _observe_terminal(resource, "succeeded", observed_at)
                _observe_terminal(record, "succeeded", observed_at)
                return update(root, record, state="succeeded", completed_at=observed_at)
            if mode == "upload" and resources:
                for resource in record["resources"]:
                    resource["state"] = "succeeded"
                    _observe_terminal(resource, "succeeded", observed_at)
                _observe_terminal(record, "succeeded", observed_at)
                return update(root, record, state="succeeded", completed_at=observed_at)
            if resources:
                state = _aggregate_state(resources)
                _observe_terminal(record, state, observed_at)
                return update(root, record, state=state)
            update(root, record, state="submission-unknown")
            raise GenerationError(
                "Provider accepted a response without the expected result/job ID; retain it and recover, do not resubmit"
            )
        except APIError as exc:
            _error(root, record, exc, "submit")
            update(root, record, state="submission-unknown" if exc.ambiguous else "failed")
            raise
        except BaseException:
            # Includes Ctrl-C and unexpected local parsing/storage failure after dispatch.
            if record["state"] == "submitting":
                update(root, record, state="submission-unknown")
            raise


def create(directory, path, payload, *, client=None, **options):
    prepare(directory, path, payload, **options)
    return submit(directory, payload, client=client)


def replay(directory, *, resolution=None):
    """The request that makes a Video 1 job's take again: its stored request plus the seed HeyGen used.

    Within a deployment the same request and seed give the same file, and the same request at 2k
    finishes a 768p pick as the same take. Submit the result as a new job.
    """
    root = Path(directory)
    record = read_json(root / "job.json")
    require(record.get("route") == "/v3/models/videos", "Only a Video 1 job replays by its seed")
    require(
        record.get("state") == "succeeded",
        f"This job is {record.get('state')}; only a finished take replays. Wait on it first",
    )
    require(
        type(record.get("seed")) is int,
        "No seed is recorded for this job; wait on it until it succeeds, then replay",
    )
    request = read_json(root / record["request_path"])
    require(
        sha(canonical(request)) == record["request_sha256"],
        "The stored request lost inline base64 or a signed URL to redaction, so it cannot be "
        "replayed; send references as uploaded asset_id",
    )
    require(
        request.get("prompt_enhancement") == "disabled",
        "This take was made with the prompt rewriter on, which is not deterministic, so its seed "
        "does not make the same take again",
    )
    require(
        resolution != "2k"
        or request.get("mode") == "image_to_video"
        or request.get("aspect_ratio") in ("16:9", "9:16"),
        "Video 1 makes 2k only at 16:9 or 9:16, and this take is "
        f"{request.get('aspect_ratio', 'adaptive')}; it cannot be finished at 2k as the same take",
    )
    return {**request, "seed": record["seed"], **({"resolution": resolution} if resolution else {})}


def upload(source, directory, *, client=None):
    source = Path(source).resolve()
    payload = {"file": {"name": source.name, "sha256": file_hash(source)}}
    prepare(directory, "/v3/assets", payload, upload_file=source)
    return submit(directory, payload, client=client)


def recover(directory, provider_ids, *, evidence, status_path=None, resource_kind=None):
    """Bind IDs found through provider discovery/webhook; requires provenance text."""
    require(
        isinstance(evidence, str) and evidence.strip(), "Explain where the recovered IDs came from"
    )
    require(
        provider_ids and all(isinstance(x, str) and x for x in provider_ids),
        "Supply recovered provider IDs",
    )
    with locked(directory) as root:
        record = read_json(root / "job.json")
        require(
            record["state"] in ("submitting", "submission-unknown"),
            "Recovery binds only an unknown submission",
        )
        if status_path:
            validate_path(status_path)
            require("{id}" in status_path, "Status path must contain {id}")
            record["route_contract"]["status"] = status_path
        kind = resource_kind or record["route_contract"].get("resource_kind")
        resource_status = {
            "avatar-look": "/v3/avatars/looks/{id}",
            "avatar-group": "/v3/avatars/{id}",
            "professional-voice": "/v3/models/audio/voices/{id}",
        }
        require(
            resource_kind is None or resource_kind in resource_status,
            "Recovered resource kind must be avatar-look, avatar-group, or professional-voice",
        )
        require(
            record["route_contract"].get("status"),
            "This synchronous route has no job polling endpoint; inspect retained response/provider records",
        )
        return update(
            root,
            record,
            state="submitted",
            resources=[
                {
                    "id": rid,
                    "state": "submitted",
                    **({"kind": kind} if kind else {}),
                    **({"status_path": resource_status[kind]} if kind and not status_path else {}),
                }
                for rid in provider_ids
            ],
            recovery_evidence=redact(evidence),
        )


def status(directory, *, client=None, deadline=None):
    client = client or default_client()
    with locked(directory) as root:
        record = read_json(root / "job.json")
        _check_client(record, client)
        if record["state"] == "submitting":
            update(root, record, state="submission-unknown", event="interrupted-submit")
        require(
            record["resources"] or record["state"] == "succeeded",
            "No provider ID is known; inspect retained submit response/provider listing and use recover",
        )
        default_template = record["route_contract"].get("status")
        if not default_template:
            return record
        observed_at = None
        for i, resource in enumerate(record["resources"]):
            template = resource.get("status_path", default_template)
            remaining = deadline - time.monotonic() if deadline is not None else None
            if remaining is not None and remaining <= 0:
                break
            try:
                response = client.request(
                    "GET",
                    template.replace("{id}", urllib.parse.quote(resource["id"], safe="")),
                    timeout=remaining,
                )
                name = f"status-{i:03d}"
                data = _response(root, record, response, name)
                observed_at = record["last_response_received_at"]
                resource.update(
                    state=_state(data.get("status"), resource.get("kind")),
                    provider_status=data.get("status"),
                    response_path=name + ".private.json",
                    response_sha256=record["last_response_sha256"],
                    checked_at=observed_at,
                )
                _observe_terminal(resource, resource["state"], observed_at)
                resource.pop("response_data_key", None)
                update(root, record, event="resource-status")
            except APIError as exc:
                _error(root, record, exc, "status")
                update(root, record, event="status-unavailable")
                raise
        state = _aggregate_state(record["resources"])
        if observed_at:
            _observe_terminal(record, state, observed_at)
        return update(root, record, state=state)


def wait(directory, *, seconds=45, interval=5, client=None):
    require(
        0 <= seconds <= 60 and 0 < interval <= 60,
        "Wait is bounded to 60 seconds; call again to resume the same job",
    )
    if seconds == 0:
        return inspect_job(directory)
    client = client or default_client()
    end = time.monotonic() + seconds
    while True:
        result = status(directory, client=client, deadline=end)
        remaining = end - time.monotonic()
        if result["state"] in TERMINAL | {"needs-input", "provider-unknown"} or remaining <= 0:
            return result
        time.sleep(min(interval, remaining))
        if time.monotonic() >= end:
            return result


def _download_url(url, target):
    parsed = urllib.parse.urlsplit(url)
    require(
        parsed.scheme == "https"
        and parsed.hostname
        and not parsed.username
        and not parsed.password,
        "Generated output must use an HTTPS URL without embedded credentials",
    )
    # No API headers are passed to signed media URLs or their redirects.
    with urllib.request.urlopen(url, timeout=45) as response, target.open("xb") as output:
        shutil.copyfileobj(response, output)
        output.flush()
        os.fsync(output.fileno())


def _probe(path):
    if not shutil.which("ffprobe"):
        return {"status": "unverified", "reason": "ffprobe not found"}
    command = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration,format_name:stream=codec_type,codec_name,width,height,sample_rate",
        "-of",
        "json",
        str(path),
    ]
    result = subprocess.run(command, capture_output=True, text=True, timeout=45)
    if result.returncode:
        raise GenerationError(
            "Downloaded media failed ffprobe; keep the partial output for inspection"
        )
    data = json.loads(result.stdout)
    require(bool(data.get("streams")), "Downloaded file has no decodable media stream")
    return {
        "status": "container-probed",
        **data,
        "note": "Container inspection does not prove full decode, lip sync, identity, or creative quality",
    }


def _field(value, path):
    for key in path.split("."):
        if isinstance(value, list) and key.isdigit():
            value = value[int(key)] if int(key) < len(value) else None
        elif isinstance(value, dict):
            value = value.get(key)
        else:
            return None
    return value


def _save_json_output(root, record, responses, output_dir):
    """Keep a text result (a transcript) as JSON beside the job; it carries no file URL to fetch."""
    keys = record["route_contract"]["json_output"]
    for index, resource in responses:
        response = read_json(root / resource["response_path"])
        require(
            sha(canonical(response)) == resource["response_sha256"],
            "Stored private provider response changed",
        )
        data = data_object(response)
        target = output_dir / f"{index:03d}-result.json"
        if any(v["resource_id"] == resource["id"] for v in record["outputs"]):
            continue
        write_json(target, {key: data.get(key) for key in keys if key in data})
        record["outputs"].append(
            {
                "resource_id": resource["id"],
                "field": "result",
                "path": str(target.relative_to(root)),
                "sha256": file_hash(target),
                "bytes": target.stat().st_size,
                "acceptance": "not-reviewed",
            }
        )
        update(root, record, event="output-saved")
    return record


def download_outputs(directory, *, fields=None, fetch=None, probe=True):
    """Preserve native audio/video bytes. Downloads good siblings even if a batch fails."""
    fetch = fetch or _download_url
    with locked(directory) as root:
        record = read_json(root / "job.json")
        fields = (
            fields
            or record["route_contract"].get("output_fields")
            or (
                ("preview_image_url", "preview_video_url")
                if record["route_contract"].get("result_kind") in ("avatar-create", "avatar-looks")
                else ("video_url", "audio_url")
            )
        )
        responses: list[tuple[int, dict[str, Any]]] = [
            (i, r)
            for i, r in enumerate(record["resources"])
            if r["state"] == "succeeded" and r.get("response_path")
        ]
        if not responses and record["state"] == "succeeded" and record.get("last_private_response"):
            responses = [
                (
                    0,
                    {
                        "id": record.get("provider_request_id") or "result",
                        "response_path": record["last_private_response"],
                        "response_sha256": record["last_response_sha256"],
                    },
                )
            ]
        require(responses, "No successful result is available; query the provider job first")
        output_dir = root / "outputs"
        output_dir.mkdir(exist_ok=True)
        if record["route_contract"].get("json_output"):
            return _save_json_output(root, record, responses, output_dir)
        found = False
        for index, resource in responses:
            rid, kind = resource["id"], resource.get("kind")
            response = read_json(root / resource["response_path"])
            require(
                sha(canonical(response)) == resource["response_sha256"],
                "Stored private provider response changed",
            )
            data = data_object(response)
            if resource.get("response_data_key"):
                data = data.get(resource["response_data_key"], {})
            for field in fields:
                url = _field(data, field)
                if not isinstance(url, str) or not url:
                    continue
                found = True
                suffix = Path(urllib.parse.urlsplit(url).path).suffix.lower()
                if suffix not in (
                    ".mp4",
                    ".webm",
                    ".wav",
                    ".mp3",
                    ".m4a",
                    ".srt",
                    ".vtt",
                    ".png",
                    ".jpg",
                    ".jpeg",
                    ".webp",
                ):
                    suffix = (
                        ".mp4"
                        if "video" in field
                        else ".mp3"
                        if "audio" in field
                        else ".png"
                        if field.startswith("images.")
                        else ".bin"
                    )
                target = output_dir / f"{index:03d}-{field}{suffix}"
                existing = next(
                    (
                        v
                        for v in record["outputs"]
                        if v["resource_id"] == rid
                        and v.get("resource_kind") == kind
                        and v["field"] == field
                    ),
                    None,
                )
                if existing:
                    previous = root / existing["path"]
                    require(
                        previous.is_file() and file_hash(previous) == existing["sha256"],
                        "Previously downloaded output is missing or changed; do not overwrite accepted bytes",
                    )
                    continue
                require(
                    not target.exists(),
                    "Unrecorded output exists after an interrupted download; inspect it before choosing a new result directory",
                )
                partial = target.with_suffix(target.suffix + ".partial")
                require(
                    not partial.exists(),
                    "A partial download already exists; inspect/remove that incomplete file before retrying download",
                )
                download_started_at = stamp()
                _append_event(
                    root,
                    record,
                    "download-started",
                    at=download_started_at,
                    resource_id=rid,
                    field=field,
                )
                started = time.monotonic()
                try:
                    fetch(url, partial)
                    received_at = stamp()
                    download_elapsed = time.monotonic() - started
                    _append_event(
                        root,
                        record,
                        "download-received",
                        at=received_at,
                        resource_id=rid,
                        field=field,
                        download_started_at=download_started_at,
                        received_at=received_at,
                        download_elapsed_seconds=download_elapsed,
                    )
                    require(partial.stat().st_size > 0, "Generated output is empty")
                    facts = (
                        _probe(partial)
                        if probe and suffix in (".mp4", ".webm", ".wav", ".mp3", ".m4a")
                        else {"status": "not-probed"}
                    )
                    digest = file_hash(partial)
                    format_info = facts.get("format", {})
                    actual_format = (
                        format_info.get("format_name", "") if isinstance(format_info, dict) else ""
                    ).split(",")[0]
                    actual_suffix = {
                        "mp3": ".mp3",
                        "wav": ".wav",
                        "matroska": ".webm",
                        "mov": ".mp4",
                    }.get(actual_format)
                    if actual_suffix and actual_suffix != suffix:
                        target = target.with_suffix(actual_suffix)
                        require(
                            not target.exists(),
                            "Container-corrected output name already exists; inspect it before replacement",
                        )
                    os.replace(partial, target)
                    record["outputs"].append(
                        {
                            "resource_id": rid,
                            **({"resource_kind": kind} if kind else {}),
                            "field": field,
                            "path": str(target.relative_to(root)),
                            "sha256": digest,
                            "bytes": target.stat().st_size,
                            "media": facts,
                            "download_started_at": download_started_at,
                            "received_at": received_at,
                            "download_elapsed_seconds": download_elapsed,
                            "acceptance": "not-reviewed",
                        }
                    )
                    update(root, record, event="output-downloaded")
                except BaseException:
                    update(root, record, event="download-incomplete")
                    raise
        require(found, "Successful response contains none of the requested output URL fields")
        return record


def build_parser():
    parser = argparse.ArgumentParser(prog="hf-media jobs", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("catalog", help="Native route inventory and discovery paths")
    sub.add_parser(
        "credentials",
        help="Report who pays and whether HeyGen is usable; never prints credentials",
    )
    schema = sub.add_parser(
        "schema", help="Print exact native operation + referenced schema components"
    )
    schema.add_argument("path")
    schema.add_argument("--method", default="POST", choices=("GET", "POST"))
    schema.add_argument("--openapi", help="Use a caller-fetched current OpenAPI JSON")
    query_p = sub.add_parser("query", help="Read native workspace voice/look/job discovery")
    query_p.add_argument("path")
    query_p.add_argument("--out")
    check = sub.add_parser(
        "preflight", help="Validate native payload and query voice/look compatibility"
    )
    check.add_argument("path")
    check.add_argument("request")
    for action in ("prepare", "create"):
        action_p = sub.add_parser(
            action,
            help="Freeze a job" if action == "prepare" else "Freeze and submit one native request",
        )
        action_p.add_argument("path")
        action_p.add_argument("request")
        action_p.add_argument("--job", required=True)
        action_p.add_argument("--input", action="append", default=[])
        action_p.add_argument("--raw", action="store_true")
        action_p.add_argument("--status-path")
        action_p.add_argument("--idempotency-key")
    submit_p = sub.add_parser("submit", help="Submit a prepared request exactly once")
    submit_p.add_argument("job")
    submit_p.add_argument("request")
    replay_p = sub.add_parser(
        "replay", help="Print a Video 1 job's stored request with its seed, to submit as a new job"
    )
    replay_p.add_argument("job")
    replay_p.add_argument("--resolution", choices=("480p", "768p", "2k"))
    upload_p = sub.add_parser("upload", help="Upload an actual file with a hash-bound receipt")
    upload_p.add_argument("source")
    upload_p.add_argument("--job", required=True)
    for action in ("inspect", "status", "wait", "download", "recover"):
        action_p = sub.add_parser(action)
        action_p.add_argument("job")
        if action == "wait":
            action_p.add_argument("--seconds", type=float, default=45)
            action_p.add_argument("--interval", type=float, default=5)
        if action == "download":
            action_p.add_argument("--field", action="append")
            action_p.add_argument("--no-probe", action="store_true")
        if action == "recover":
            action_p.add_argument("--id", action="append", required=True)
            action_p.add_argument("--evidence", required=True)
            action_p.add_argument("--status-path")
            action_p.add_argument(
                "--resource-kind", choices=("avatar-look", "avatar-group", "professional-voice")
            )
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        if args.command == "catalog":
            result = catalog()
        elif args.command == "credentials":
            result = credential_state()
        elif args.command == "schema":
            result = request_schema(
                args.path, args.method, spec=read_json(args.openapi) if args.openapi else None
            )
        elif args.command == "query":
            result = query(args.path, out=args.out)
        elif args.command == "preflight":
            result = preflight(args.path, read_json(args.request))
        elif args.command in ("prepare", "create"):
            function = prepare if args.command == "prepare" else create
            result = function(
                args.job,
                args.path,
                read_json(args.request),
                inputs=args.input,
                raw=args.raw,
                status_path=args.status_path,
                idempotency_key=args.idempotency_key,
            )
        elif args.command == "submit":
            result = submit(args.job, read_json(args.request))
        elif args.command == "replay":
            result = replay(args.job, resolution=args.resolution)
        elif args.command == "upload":
            result = upload(args.source, args.job)
        elif args.command == "inspect":
            result = inspect_job(args.job)
        elif args.command == "status":
            result = status(args.job)
        elif args.command == "wait":
            result = wait(args.job, seconds=args.seconds, interval=args.interval)
        elif args.command == "download":
            result = download_outputs(args.job, fields=args.field, probe=not args.no_probe)
        elif args.command == "recover":
            result = recover(
                args.job,
                args.id,
                evidence=args.evidence,
                status_path=args.status_path,
                resource_kind=args.resource_kind,
            )
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (GenerationError, OSError, ValueError, KeyError) as exc:
        error = {"error": str(exc) if isinstance(exc, GenerationError) else type(exc).__name__}
        if isinstance(exc, APIError):
            error.update(
                http_status=exc.status, submission_ambiguous=exc.ambiguous, detail=exc.detail
            )
        print(json.dumps(error, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
