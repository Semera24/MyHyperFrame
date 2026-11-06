#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.bun/bin:$PATH"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HF_DIR="$ROOT_DIR/hyperframes"
STUDIO_DIR="$HF_DIR/packages/studio"
PROJECTS_DIR="$STUDIO_DIR/data/projects"

FORCE_BUILD=0
TARGET_SOURCES=""
PORT="${PORT:-5190}"

for arg in "$@"; do
  case "$arg" in
    --build|-b)
      FORCE_BUILD=1
      ;;
    --port=*)
      PORT="${arg#*=}"
      ;;
    *)
      TARGET_SOURCES="$arg"
      ;;
  esac
done

PROD_STUDIO_DIR="${PRODUCTION_STUDIO_DIR:-$HOME/Projects/ProductionStudio}"
DEFAULT_EP04="$PROD_STUDIO_DIR/channels/Turning_Point_Stories/episodes/EP04_Suez_Hormuz_Waterways/Sources"
DEFAULT_EP03="$PROD_STUDIO_DIR/channels/Turning_Point_Stories/episodes/EP03_Rome_Italy_Superpower/Sources"

if [[ -z "$TARGET_SOURCES" ]]; then
  TARGET_SOURCES="$DEFAULT_EP04"
fi

if [[ ! -d "$TARGET_SOURCES" ]]; then
  echo "Error: Target Sources directory does not exist: $TARGET_SOURCES" >&2
  exit 1
fi

TARGET_SOURCES="$(cd "$TARGET_SOURCES" && pwd)"

derive_project_slug() {
  local src_path="$1"
  local base
  base="$(basename "$src_path")"
  if [[ "$base" == "Sources" || "$base" == "sources" ]]; then
    basename "$(dirname "$src_path")"
  else
    echo "$base"
  fi
}

mkdir -p "$PROJECTS_DIR"

# Auto-link all episodes across all channels in ProductionStudio
PROD_CHANNELS_DIR="$PROD_STUDIO_DIR/channels"
if [[ -d "$PROD_CHANNELS_DIR" ]]; then
  for ep_sources in "$PROD_CHANNELS_DIR"/*/episodes/*/Sources; do
    if [[ -d "$ep_sources" ]]; then
      ep_slug="$(derive_project_slug "$ep_sources")"
      ln -sfn "$ep_sources" "$PROJECTS_DIR/$ep_slug"
    fi
  done
fi

PROJECT_SLUG="$(derive_project_slug "$TARGET_SOURCES")"
ln -sfn "$TARGET_SOURCES" "$PROJECTS_DIR/$PROJECT_SLUG"

# Ensure workspace packages are built if dist artifacts are missing or --build was passed
if [[ "$FORCE_BUILD" -eq 1 || ! -d "$HF_DIR/packages/core/dist" || ! -d "$HF_DIR/packages/studio-server/dist" || ! -d "$HF_DIR/packages/player/dist" ]]; then
  echo "Building HyperFrames workspace packages..."
  (
    cd "$HF_DIR"
    bun run --filter '@hyperframes/{parsers,lint,studio-server}' build
    bun run --filter @hyperframes/core build
    bun run --filter '@hyperframes/{player,sdk,shader-transitions}' build
  )
fi

export HYPERFRAMES_PREVIEW_PROJECT_DIR="$TARGET_SOURCES"
export HYPERFRAMES_PREVIEW_PROJECT_NAME="$PROJECT_SLUG"

echo "============================================================"
echo "  HyperFrames Custom Studio (Palmier Manual Editor)"
echo "  Active Project : $PROJECT_SLUG"
echo "  Sources Path   : $TARGET_SOURCES"
echo "  Studio URL     : http://127.0.0.1:$PORT/?project=$PROJECT_SLUG"
echo "============================================================"

cd "$STUDIO_DIR"
exec bunx vite --host 127.0.0.1 --port "$PORT"
