import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { OverlayRect } from "./domEditOverlayGeometry";

/** Rotate handle below the selection: an attached circular-arrows icon chip
 *  with an adjacent precise numeric rotation input field (degrees). Anchors
 *  to the crop outline when the element is cropped so it stays next to what's
 *  visible on screen. */
export function DomEditRotateHandle({
  overlayRect,
  cropOutlineInsetPx,
  onStartRotate,
  onCommitRotation,
}: {
  overlayRect: OverlayRect;
  cropOutlineInsetPx?: { top: number; right: number; bottom: number; left: number };
  onStartRotate: (e: ReactPointerEvent<HTMLButtonElement>) => void;
  onCommitRotation?: (angle: number) => void;
}) {
  const [editingValue, setEditingValue] = useState<string | null>(null);
  const isCancelledRef = useRef(false);
  const isCommittedRef = useRef(false);
  const inset = cropOutlineInsetPx ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const visibleLeft = overlayRect.left + inset.left;
  const visibleWidth = Math.max(0, overlayRect.width - inset.left - inset.right);
  const visibleTop = overlayRect.top + inset.top;
  const visibleBottom = overlayRect.top + overlayRect.height - inset.bottom;
  const currentAngle = Math.round((overlayRect.angle ?? 0) * 10) / 10;

  // Place above the selection so it never covers text lines or elements below it.
  // If the selection is flush against the top boundary (< 32px), place it below.
  const placeAbove = visibleTop >= 32;
  const topPos = placeAbove ? visibleTop - 28 : visibleBottom + 12;

  const commitValue = (valStr: string) => {
    const clean = valStr.replace("°", "").trim();
    const parsed = Number.parseFloat(clean);
    if (Number.isFinite(parsed) && onCommitRotation) {
      onCommitRotation(parsed);
    }
    setEditingValue(null);
  };

  return (
    <div
      data-dom-edit-rotate-control="true"
      className="pointer-events-auto absolute flex items-center gap-1.5"
      style={{
        left: visibleLeft + visibleWidth / 2,
        top: topPos,
        transform: "translateX(-50%)",
        touchAction: "none",
      }}
    >
      {placeAbove ? (
        <div className="pointer-events-none absolute left-1/2 -bottom-[12px] h-[12px] w-[1px] -translate-x-1/2 bg-studio-accent/40" />
      ) : (
        <div className="pointer-events-none absolute left-1/2 -top-[12px] h-[12px] w-[1px] -translate-x-1/2 bg-studio-accent/40" />
      )}
      <button
        type="button"
        className="flex items-center justify-center border-0 bg-transparent p-0"
        style={{
          width: 22,
          height: 22,
          touchAction: "none",
          // Closed-hand grab cursor: this handle is grabbed and dragged to rotate.
          cursor: "grabbing",
        }}
        title="Rotate (drag handle or type exact degrees)"
        aria-label="Rotate selection"
        onPointerDown={onStartRotate}
      >
        <span className="pointer-events-none flex h-[18px] w-[18px] items-center justify-center rounded-full border border-studio-accent/70 bg-studio-surface text-accent-ink shadow-[0_0_3px_rgba(0,0,0,0.45)]">
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
            <path d="M8 16H3v5" />
          </svg>
        </span>
      </button>

      {onCommitRotation && (
        <div
          className="flex items-center rounded border border-studio-accent/60 bg-studio-surface/95 px-1 py-0.5 shadow-[0_1px_4px_rgba(0,0,0,0.5)]"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <input
            type="text"
            data-testid="canvas-rotation-input"
            aria-label="Rotation (degrees)"
            title="Rotation (degrees)"
            className="w-11 bg-transparent text-center font-mono text-[10.5px] font-medium text-text-0 outline-hidden hover:text-accent-ink focus:text-accent-ink"
            value={editingValue !== null ? editingValue : `${currentAngle}°`}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onFocus={(e) => {
              isCancelledRef.current = false;
              isCommittedRef.current = false;
              setEditingValue(String(currentAngle));
              const target = e.currentTarget;
              setTimeout(() => {
                try {
                  target.select();
                } catch {
                  /* input unmounted guard */
                }
              }, 0);
            }}
            onChange={(e) => setEditingValue(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                e.preventDefault();
                isCancelledRef.current = false;
                isCommittedRef.current = true;
                commitValue(editingValue ?? e.currentTarget.value);
                e.currentTarget.blur();
              } else if (e.key === "Escape") {
                e.preventDefault();
                isCancelledRef.current = true;
                setEditingValue(null);
                e.currentTarget.blur();
              }
            }}
            onBlur={(e) => {
              if (isCancelledRef.current || isCommittedRef.current) {
                isCancelledRef.current = false;
                isCommittedRef.current = false;
                setEditingValue(null);
                return;
              }
              const val = editingValue !== null ? editingValue : e.currentTarget.value;
              commitValue(val);
            }}
          />
        </div>
      )}
    </div>
  );
}
