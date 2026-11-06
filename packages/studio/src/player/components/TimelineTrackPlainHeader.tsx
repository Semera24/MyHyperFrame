import type React from "react";
import { Music } from "../../icons/SystemIcons";
import type { TimelineEditCallbacks } from "./timelineCallbacks";
import { TrackClipCount } from "./TrackClipCount";
import { trackDisplaySuffix } from "./timelineTrackDisplay";
import { HiddenToggleIcon, hiddenToggleVerb } from "./hiddenToggle";

export function TrackDragGrip({
  trackNumber,
  trackLabel,
  onDragReorderTrack,
}: {
  trackNumber: number;
  trackLabel: string;
  onDragReorderTrack?: (fromTrackNumber: number, toTrackNumber: number) => void;
}) {
  if (!onDragReorderTrack) return null;
  return (
    <span
      role="button"
      tabIndex={-1}
      aria-label={`Drag ${trackLabel} to reorder layer`}
      title="Drag up/down to reorder layer (updates canvas z-index)"
      className="flex h-5 w-3.5 shrink-0 cursor-grab select-none items-center justify-center rounded text-[11px] leading-none text-[var(--timeline-text-faint)] hover:bg-white/10 hover:text-[var(--timeline-text-solid)] active:cursor-grabbing"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        event.preventDefault();
        let hoveredEl: HTMLElement | null = null;
        let targetTrack: number | null = null;

        const clearHighlight = () => {
          if (hoveredEl) {
            hoveredEl.style.boxShadow = "";
            hoveredEl = null;
          }
        };

        const onPointerMove = (moveEvent: PointerEvent) => {
          const elUnder = document
            .elementFromPoint(moveEvent.clientX, moveEvent.clientY)
            ?.closest<HTMLElement>("[data-timeline-track-num]");
          if (!elUnder) {
            clearHighlight();
            targetTrack = null;
            return;
          }
          const numAttr = elUnder.getAttribute("data-timeline-track-num");
          const parsed = numAttr !== null ? Number(numAttr) : Number.NaN;
          if (!Number.isFinite(parsed) || parsed === trackNumber) {
            clearHighlight();
            targetTrack = null;
            return;
          }
          if (hoveredEl !== elUnder) {
            clearHighlight();
            hoveredEl = elUnder;
            const rect = elUnder.getBoundingClientRect();
            const isAbove = moveEvent.clientY < rect.top + rect.height / 2;
            hoveredEl.style.boxShadow = isAbove
              ? "inset 0 2px 0 0 var(--timeline-accent)"
              : "inset 0 -2px 0 0 var(--timeline-accent)";
          }
          targetTrack = parsed;
        };

        const onPointerUp = () => {
          window.removeEventListener("pointermove", onPointerMove);
          window.removeEventListener("pointerup", onPointerUp);
          window.removeEventListener("pointercancel", onPointerUp);
          clearHighlight();
          if (targetTrack !== null && targetTrack !== trackNumber) {
            onDragReorderTrack(trackNumber, targetTrack);
          }
        };

        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
        window.addEventListener("pointercancel", onPointerUp);
      }}
    >
      ⠿
    </span>
  );
}

export function TrackOrderButtons({
  trackLabel,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
}: {
  trackLabel: string;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  if (!onMoveUp && !onMoveDown) return null;
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        disabled={!canMoveUp}
        aria-label={`Move ${trackLabel} layer up (Bring Forward)`}
        title="Move Layer Up / Bring Forward (higher z-index)"
        className="flex h-5 w-4 shrink-0 items-center justify-center rounded border-0 bg-transparent p-0 text-[10px] leading-none text-[var(--timeline-text-faint)] transition-colors hover:bg-white/10 hover:text-[var(--timeline-text-solid)] disabled:pointer-events-none disabled:opacity-25"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onMoveUp?.();
        }}
      >
        ↑
      </button>
      <button
        type="button"
        disabled={!canMoveDown}
        aria-label={`Move ${trackLabel} layer down (Send Backward)`}
        title="Move Layer Down / Send Backward (lower z-index)"
        className="flex h-5 w-4 shrink-0 items-center justify-center rounded border-0 bg-transparent p-0 text-[10px] leading-none text-[var(--timeline-text-faint)] transition-colors hover:bg-white/10 hover:text-[var(--timeline-text-solid)] disabled:pointer-events-none disabled:opacity-25"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onMoveDown?.();
        }}
      >
        ↓
      </button>
    </div>
  );
}

export function VisibilityButton({
  hidden,
  trackNumber,
  trackDisplayNumber,
  asMute,
  onToggle,
}: {
  hidden: boolean;
  trackNumber: number;
  trackDisplayNumber: number | null;
  /** `data-hidden` silences an audio-only track, so its toggle is a mute. */
  asMute: boolean;
  onToggle: TimelineEditCallbacks["onToggleTrackHidden"];
}) {
  // Display number in the text, real key in the callback. The two must not be
  // conflated in either direction.
  const suffix = trackDisplaySuffix(trackDisplayNumber);
  const label = `${hiddenToggleVerb(asMute, hidden)} track${suffix}`;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border-0 bg-transparent p-0 transition-colors focus-visible:outline-solid focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-[var(--timeline-accent)] ${
        hidden
          ? "text-[var(--timeline-accent)] hover:text-[var(--timeline-text-solid)]"
          : "text-[var(--timeline-text-faint)] hover:text-[var(--timeline-text-soft)]"
      }`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        // Display number alongside the real key: the undo-history label must
        // announce the same row this button just did (see `onToggleTrackHidden`).
        void onToggle?.(trackNumber, !hidden, trackDisplayNumber);
      }}
    >
      <HiddenToggleIcon asMute={asMute} hidden={hidden} size={14} />
    </button>
  );
}

// The header a track gets when it has no keyframe clip to disclose: label, clip
// count, eye. Not deprecated — it is the live path for every track without lanes.
export function PlainTrackHeader({
  trackNumber,
  trackDisplayNumber,
  trackLabel,
  clipCount,
  showTrackLabel,
  isTrackHidden,
  isAudioTrack,
  isAudioOnly,
  onToggleTrackHidden,
  leading,
  orderButtons,
  trailing,
}: {
  trackNumber: number;
  trackDisplayNumber: number | null;
  trackLabel: string;
  clipCount: number;
  isTrackHidden: boolean;
  isAudioTrack: boolean;
  isAudioOnly: boolean;
  onToggleTrackHidden: TimelineEditCallbacks["onToggleTrackHidden"];
  showTrackLabel: boolean;
  leading?: React.ReactNode;
  orderButtons?: React.ReactNode;
  /** Trailing controls that belong on the control line — the FX entry points,
   *  which the caller owns because only it knows the clip they act on. */
  trailing?: React.ReactNode;
}) {
  return (
    <>
      {/* One line: the name, then every control pushed to the right edge. The
          two-line split this replaced existed to stop four controls truncating
          the name — but the name already truncates on its own (`min-w-0` plus
          `truncate`), and the controls are `shrink-0`, so they hold the edge
          and the name gives way instead. */}
      <div className="flex min-w-0 items-center gap-1">
        {leading}
        {isAudioTrack && (
          <Music
            size={12}
            weight="fill"
            aria-hidden="true"
            className="text-[var(--timeline-text-faint)]"
          />
        )}
        {/* No `flex-1`: the name takes only the width it needs, so the clip
            count sits against it rather than being pushed out to meet the
            controls. The slack goes to the `ml-auto` group below instead. */}
        {showTrackLabel && (
          <span title={trackLabel} className="min-w-0 truncate text-[11px] leading-tight">
            {trackLabel}
          </span>
        )}
        {showTrackLabel && <TrackClipCount clipCount={clipCount} />}
        {/* `ml-auto` is what anchors the group right: it absorbs the slack the
            truncating name leaves, so the controls sit on the edge whatever the
            name's length. */}
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {orderButtons}
          <VisibilityButton
            hidden={isTrackHidden}
            trackNumber={trackNumber}
            trackDisplayNumber={trackDisplayNumber}
            asMute={isAudioOnly}
            onToggle={onToggleTrackHidden}
          />
          {trailing}
        </div>
      </div>
    </>
  );
}
