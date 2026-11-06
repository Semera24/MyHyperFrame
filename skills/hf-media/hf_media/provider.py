"""Explicit models, native payloads, and recoverable calls. No creative orchestration."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

from . import generation as g

# A model binds an operation to one native route. There is no fallback or implicit ranking.
MODELS: dict[str, dict[str, Any]] = {
    # HeyGen /v3/images: billed to HeyGen API credits. A non-empty reference_images list is an edit.
    "heygen-gpt-image-2.5": {
        "provider": "heygen",
        "operations": {"generate": "/v3/images", "edit": "/v3/images"},
        "fixed": {"model": "gpt-image-2.5"},
    },
    "heygen-nano-banana-2": {
        "provider": "heygen",
        "operations": {"generate": "/v3/images", "edit": "/v3/images"},
        "fixed": {"model": "nano-banana-2"},
    },
    "heygen-video-1": {
        "provider": "heygen",
        "operations": {"generate": "/v3/models/videos"},
        "fixed": {"model": "heygen-video-1"},
    },
    # HeyGen /v3/video-generations: vendor models billed to HeyGen API credits.
    "heygen-h3-max": {
        "provider": "heygen",
        "operations": {"generate": "/v3/video-generations"},
        "fixed": {"model": "minimax-h3-max"},
    },
    "heygen-seedance-2.5": {
        "provider": "heygen",
        "operations": {"generate": "/v3/video-generations"},
        "fixed": {"model": "seedance-2.5"},
    },
    "heygen-orca": {
        "provider": "heygen",
        "operations": {"generate": "/v3/voices/speech"},
        "fixed": {"engine": "orca"},
    },
    "elevenlabs-v3": {
        "provider": "heygen",
        "operations": {"generate": "/v3/voices/speech"},
        "fixed": {"engine": "elevenlabs_v3"},
    },
    "heygen-avatar": {
        "provider": "heygen",
        "operations": {
            "generate": "/v3/videos",
            "create": "/v3/avatars",
            "create-looks": "/v3/avatars/looks",
        },
    },
}

DEFAULT_CONFIG = {
    "providers": {
        "heygen": {"base_url": g.API, "credential_env": "HEYGEN_API_KEY", "enabled": True},
    }
}


def configuration(path=None):
    """Load non-secret host configuration; credentials stay in environment/HeyGen login."""
    path = path or os.environ.get("OMNI_REF_PROVIDER_CONFIG")
    override = g.read_json(path) if path else {}
    g.require(
        isinstance(override, dict) and set(override) <= {"providers", "name"},
        "Provider config accepts only a providers object, with credential_env names, and a name",
    )
    profile = override.get("name")
    g.require(
        profile is None
        or (isinstance(profile, str) and re.fullmatch(r"[A-Za-z0-9][\w.-]{0,63}", profile, re.ASCII)),
        "name must be a short host profile name",
    )
    entries = override.get("providers", {})
    g.require(isinstance(entries, dict), "providers must be an object")
    # HyperFrames Desktop builds still write a disabled fal entry; accept only that and ignore it.
    if entries.get("fal") == {"enabled": False}:
        entries = {k: v for k, v in entries.items() if k != "fal"}
    g.require(
        set(entries) <= set(DEFAULT_CONFIG["providers"]),
        "The only configurable provider is heygen; remove other provider entries",
    )
    result = {}
    for name, default in DEFAULT_CONFIG["providers"].items():
        entry = entries.get(name, {})
        g.require(
            isinstance(entry, dict) and set(entry) <= set(default),
            "Provider entries accept only base_url, credential_env and enabled; never put keys here",
        )
        entry = {**default, **entry}
        g.require(isinstance(entry["enabled"], bool), "enabled must be boolean")
        g.require(
            isinstance(entry["credential_env"], str)
            and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", entry["credential_env"]),
            "credential_env must name an environment variable",
        )
        g.Client(
            headers={}, base_url=entry["base_url"], provider=name
        )  # Validate origin, no network.
        entry["base_url"] = entry["base_url"].rstrip("/")
        entry["profile"] = profile
        result[name] = entry
    return result


def client_for(provider, *, config=None):
    entries = configuration(config)
    g.require(provider in entries, f"Unsupported provider {provider}; Omni Ref calls only heygen")
    entry = entries[provider]
    g.require(entry["enabled"], f"{provider} is disabled in the host configuration")
    headers, _ = g.credential(name=entry["credential_env"])
    return g.Client(
        headers=headers, provider=provider, base_url=entry["base_url"], profile=entry["profile"]
    )


def check(*, config=None):
    """Local credential presence only. Never reports account or model eligibility."""
    results = {}
    for name, entry in configuration(config).items():
        try:
            client_for(name, config=config)
            state = "credential-present"
        except g.GenerationError as exc:
            state = str(exc)
        results[name] = {**entry, "state": state, "remote_compatibility": "not-checked"}
    return results


def binding(model, operation):
    g.require(model in MODELS, "Unknown model; use provider models")
    spec = MODELS[model]
    g.require(
        operation in spec["operations"], f"Unsupported {model} operation; use provider models"
    )
    return spec, spec["operations"][operation]


def schema(model, operation):
    spec, route = binding(model, operation)
    native = g.request_schema(route)
    # Return only this request's reachable types, not the provider's whole API catalog.
    selected: dict[str, dict] = {}
    pending = [native["schema"]]
    seen = set()
    while pending:
        node = pending.pop()
        if isinstance(node, list):
            pending.extend(node)
        elif isinstance(node, dict):
            ref = node.get("$ref")
            if ref and ref not in seen:
                seen.add(ref)
                parts = ref.split("/")
                g.require(
                    parts[:2] == ["#", "components"] and len(parts) == 4,
                    "Unexpected native schema reference",
                )
                resolved = g.resolve_ref(native, node)
                selected.setdefault(parts[2], {})[parts[3]] = resolved
                pending.append(resolved)
            pending.extend(value for key, value in node.items() if key != "$ref")
    native = {key: value for key, value in native.items() if key != "operation"}
    native["components"] = selected
    return {
        "model": model,
        "operation": operation,
        "provider": spec["provider"],
        "route": route,
        "fixed_fields": spec.get("fixed", {}),
        **native,
    }


def validate(model, operation, payload):
    """Return the actual native request and validation; fixed fields cannot be overridden."""
    spec, route = binding(model, operation)
    g.require(isinstance(payload, dict), "Native request must be a JSON object")
    g.reject_credentials(payload)
    g.canonical(payload)
    for key, value in spec.get("fixed", {}).items():
        g.require(
            key not in payload or payload[key] == value,
            f"{model} requires {key}={value}; choose the intended model explicitly",
        )
    payload = {**spec.get("fixed", {}), **payload}
    if route == "/v3/images":
        edit = bool(payload.get("reference_images"))
        g.require(
            edit == (operation == "edit"),
            "Edit requires nonempty reference_images; generate takes none",
        )
    return payload, g.validate_request(route, payload)


def prepare(model, operation, payload, *, job, inputs=(), config=None):
    """Freeze a validated job without networking. Keep the original request outside the skill."""
    spec, path = binding(model, operation)
    payload, validation = validate(model, operation, payload)
    provider = spec["provider"]
    entry = configuration(config)[provider]
    g.require(entry["enabled"], f"{provider} is disabled in the host configuration")
    route = g._route(path)
    record = g.prepare(
        job,
        path,
        payload,
        provider=provider,
        endpoint=entry["base_url"],
        profile=entry["profile"],
        route_contract=route,
        validation=validation,
        inputs=inputs,
    )
    with g.locked(job) as root:
        record.update(
            model_selected=model,
            operation=operation,
            binding_sha256=g.sha(g.canonical({"model": model, "binding": spec})),
        )
        g.write_json(root / "schema.json", schema(model, operation))
        return g.update(root, record, event="model-bound")


def submit(job, payload, *, config=None, client=None):
    record = g.inspect_job(job)
    payload, _ = validate(record["model_selected"], record["operation"], payload)
    client = client or client_for(record["provider"], config=config)
    return g.submit(job, payload, client=client)


def call(model, operation, payload, *, job, inputs=(), config=None, client=None):
    """Submit once. Existing job directories are never silently reused or resubmitted."""
    spec, _ = binding(model, operation)
    client = client or client_for(spec["provider"], config=config)
    prepare(model, operation, payload, job=job, inputs=inputs, config=config)
    return submit(job, payload, config=config, client=client)


def status(job, *, config=None, client=None):
    record = g.inspect_job(job)
    return g.status(job, client=client or client_for(record["provider"], config=config))


def wait(job, *, seconds=45, config=None, client=None):
    record = g.inspect_job(job)
    return g.wait(
        job, seconds=seconds, client=client or client_for(record["provider"], config=config)
    )


def result(job):
    """Return native results, including usable URLs/timestamps; no invented common media schema."""
    record = g.inspect_job(job)
    g.require(record["state"] == "succeeded", "Result is not ready; status/wait on this job")
    root = Path(job)
    resources = record["resources"] or [
        {
            "response_path": record["last_private_response"],
            "response_sha256": record["last_response_sha256"],
        }
    ]
    bodies = []
    for resource in resources:
        body = g.read_json(root / resource["response_path"])
        g.require(
            g.sha(g.canonical(body)) == resource["response_sha256"],
            "Stored provider result changed",
        )
        bodies.append(body)
    return bodies[0] if len(bodies) == 1 else bodies


def download(job, *, fetch=None, probe=True):
    return g.download_outputs(job, fetch=fetch, probe=probe)


def build_parser():
    parser = argparse.ArgumentParser(prog="hf-media provider", description=__doc__)
    parser.add_argument("--config", help="Host JSON profile; defaults to OMNI_REF_PROVIDER_CONFIG")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("models", help="List explicit model/operation bindings; no automatic fallback")
    sub.add_parser(
        "check", help="Check local configuration and credentials without submitting jobs"
    )
    for name in ("schema", "validate", "prepare", "call"):
        child = sub.add_parser(name)
        child.add_argument("model", choices=list(MODELS))
        child.add_argument("operation")
        if name != "schema":
            child.add_argument("request", type=Path, help="Native JSON payload file")
        if name in ("prepare", "call"):
            child.add_argument("--job", type=Path, required=True)
            child.add_argument(
                "--input",
                type=Path,
                action="append",
                default=[],
                help="Hash a real input; repeat for multiple files",
            )
    for name in ("submit", "status", "wait", "inspect", "result", "download", "recover"):
        child = sub.add_parser(name)
        child.add_argument("job", type=Path)
        if name == "submit":
            child.add_argument("request", type=Path)
        if name == "wait":
            child.add_argument("--seconds", type=float, default=45)
        if name == "result":
            child.add_argument(
                "--out",
                type=Path,
                help="Write native result privately, including usable URLs; stdout is redacted",
            )
        if name == "recover":
            child.add_argument("--id", required=True, action="append", dest="ids")
            child.add_argument("--evidence", required=True)
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        match args.command:
            case "models":
                value = MODELS
            case "check":
                value = check(config=args.config)
            case "schema":
                value = schema(args.model, args.operation)
            case "validate":
                payload, validation = validate(
                    args.model, args.operation, g.read_json(args.request)
                )
                value = {"request": payload, "validation": validation}
            case "prepare" | "call":
                function = prepare if args.command == "prepare" else call
                value = function(
                    args.model,
                    args.operation,
                    g.read_json(args.request),
                    job=args.job,
                    inputs=args.input,
                    config=args.config,
                )
            case "submit":
                value = submit(args.job, g.read_json(args.request), config=args.config)
            case "status":
                value = status(args.job, config=args.config)
            case "wait":
                value = wait(args.job, seconds=args.seconds, config=args.config)
            case "inspect":
                value = g.inspect_job(args.job)
            case "recover":
                value = g.recover(args.job, args.ids, evidence=args.evidence)
            case "download":
                value = download(args.job)
            case "result":
                value = result(args.job)
                if args.out:
                    g.write_json(args.out, value, private=True)
        print(json.dumps(g.redact(value), ensure_ascii=False, indent=2))
        return 0
    except (g.GenerationError, OSError, ValueError) as exc:
        # Do not print raw OS/config/JSON exceptions that may contain input values or secrets.
        message = (
            str(exc)
            if isinstance(exc, g.GenerationError)
            else type(exc).__name__ + ": check input files/configuration"
        )
        print(json.dumps({"error": message}), file=sys.stderr)
        return 2
