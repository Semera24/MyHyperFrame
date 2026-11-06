"""Discover real tool arguments and dispatch independent operations."""

from __future__ import annotations

import argparse
import importlib
import json
import sys

from . import __version__

TOOLS = {
    "jobs": (
        "hf_media.generation",
        "Discover and call native HeyGen capabilities with recoverable job records.",
    ),
    "provider": (
        "hf_media.provider",
        "Call selected image, video, speech, avatar and hosted ASR models with native payloads.",
    ),
    "evidence": (
        "hf_media.evidence",
        "Inspect source media, native frames, ROI, motion and measurements.",
    ),
    "review": (
        "hf_media.review",
        "Check a project's draft render against its reference and print a compact verdict.",
    ),
}


def describe(parser: argparse.ArgumentParser) -> dict:
    arguments = []
    commands = {}
    for action in parser._actions:
        if isinstance(action, argparse._SubParsersAction):
            commands = {name: describe(child) for name, child in action.choices.items()}
            continue
        arguments.append(
            {
                "name": action.dest,
                "flags": action.option_strings,
                "required": action.required,
                "nargs": action.nargs,
                "type": getattr(action.type, "__name__", "str") if action.nargs != 0 else None,
                "default": action.default,
                "action": type(action).__name__.removeprefix("_").removesuffix("Action"),
                "choices": list(action.choices) if action.choices is not None else None,
                "help": action.help,
            }
        )
    return {"description": parser.description, "arguments": arguments, "commands": commands}


def run(argv, *, name: str, title: str, version: str, tools: dict) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] in ("--help", "-h", "tools"):
        if argv and argv[0] == "tools":
            parser = argparse.ArgumentParser(description=title)
            parser.parse_args(argv[1:])
        print(
            json.dumps(
                {
                    "version": version,
                    "tools": {tool: summary for tool, (_, summary) in tools.items()},
                    "usage": f"{name} tools | {name} TOOL --help | {name} describe TOOL [COMMAND]",
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0
    if argv[0] == "--version":
        print(version)
        return 0
    if argv[0] == "describe":
        if len(argv) < 2 or argv[1] not in tools:
            print(f"Choose a tool listed by `{name} tools`.", file=sys.stderr)
            return 2
        module = importlib.import_module(tools[argv[1]][0])
        schema = describe(module.build_parser())
        for command in argv[2:]:
            if command not in schema["commands"]:
                print(f"Unknown subcommand: {command}", file=sys.stderr)
                return 2
            schema = schema["commands"][command]
        print(json.dumps(schema, ensure_ascii=False, indent=2))
        return 0
    if argv[0] not in tools:
        print(f"Unknown tool {argv[0]!r}; use `{name} tools`.", file=sys.stderr)
        return 2
    module = importlib.import_module(tools[argv[0]][0])
    return module.main(argv[1:])


def main(argv=None) -> int:
    return run(
        argv, name="hf-media", title="Discover HyperFrames media tools", version=__version__, tools=TOOLS
    )
