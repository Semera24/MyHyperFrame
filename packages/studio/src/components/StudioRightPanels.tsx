import { memo, useCallback, useEffect } from "react";
import type { StudioRightPanelsProps } from "./StudioRightPanels.types";

import { PropertyPanel } from "./editor/PropertyPanel";
import { LayersPanel } from "./editor/LayersPanel";
import { CaptionPropertyPanel } from "../captions/components/CaptionPropertyPanel";
import { BlockParamsPanel } from "./editor/BlockParamsPanel";
import { RenderQueuePanel } from "./renders/RenderQueuePanel";
import { SlideshowPanel } from "./panels/SlideshowPanel";
import { VariablesPanel } from "./panels/VariablesPanel";
import { MotionBlurPanel } from "./panels/MotionBlurPanel";
import { AgentAssistantPanel } from "./panels/AgentAssistantPanel";
import { EpisodeHandoffPanel } from "./panels/EpisodeHandoffPanel";
import { MotionInspector } from "./panels/MotionInspector";
import { ProjectSettingsInspector } from "./panels/ProjectSettingsInspector";
import { RightInspectorHeader } from "./panels/RightInspectorHeader";
import { InspectorLayerActions } from "./editor/InspectorLayerActions";
import {
  installHyperFramesAgentBridge,
  syncDeclarativeDomMotions,
} from "./editor/studioMotionAgent";
import { useStudioMotionStore } from "./editor/useStudioMotionStore";
import { Dock } from "./dock/Dock";
import { useDockLayoutStore } from "./dock/dockLayoutStore";
import type { RenderJob } from "./renders/useRenderQueue";
import { useSlideshowPersist } from "../hooks/useSlideshowPersist";
import { useSlideshowTabState } from "../hooks/useSlideshowTabState";
import {
  useBlockParamsDismissal,
  useCaptionDesignFocus,
  useSlideshowDockPanel,
} from "../hooks/useRightPanelIntents";
import { DesignPanelPromoteProvider } from "./DesignPanelPromoteProvider";
import { useStudioPlaybackContext, useStudioShellContext } from "../contexts/StudioContext";
import { useFileManagerContext } from "../contexts/FileManagerContext";
import { useDomEditContext } from "../contexts/DomEditContext";
import { usePlayerStore } from "../player";
import { timelineKeysForSelections } from "../utils/studioHelpers";
import { canHideSelections } from "../utils/timelineInspector";
import { useRemoveBackground } from "../hooks/useRemoveBackground";
import { useApplyColorGradingScope } from "../hooks/useApplyColorGradingScope";

// fallow-ignore-next-line complexity
const seekToTime = (t: number) => usePlayerStore.getState().requestSeek(t);

export const StudioRightPanels = memo(function StudioRightPanels({
  activeBlockParams,
  onCloseBlockParams,
  onDismissBlockParams,
  recordingState,
  recordingDuration,
  onToggleRecording,
  sdkSession,
  publishSdkSession,
  forceReloadSdkSession,
  reloadPreview,
  recordEdit,
  onToggleElementHidden,
  onAutoGroupCarveSources,
  onAddMediaOverlay,
}: StudioRightPanelsProps) {
  const { previewIframeRef, projectId, activeCompPath, showToast, renderQueue } =
    useStudioShellContext();
  const { captionEditMode, refreshKey } = useStudioPlaybackContext();

  const {
    domEditSelection,
    domEditGroupSelections,
    copiedAgentPrompt,
    clearDomSelection,
    handleDomEditElementDelete,
    handleUngroupSelection,
    handleGroupSelection,
    handleDomStyleCommit,
    handleDomAttributeCommit,
    handleDomAttributeLiveCommit,
    handleDomAttributeQuietCommit,
    handleDomHtmlAttributeCommit,
    handleDomAttributesCommit,
    handleDomAttributeBatchCommit,
    handleDomPathOffsetCommit,
    handleDomBoxSizeCommit,
    handleDomRotationCommit,
    handleDomTextCommit,
    handleDomTextFieldStyleCommit,
    handleDomAddTextField,
    handleDomRemoveTextField,
    handleAskAgent,
    selectedGsapAnimations,
    gsapMultipleTimelines,
    gsapUnsupportedTimelinePattern,
    handleGsapUpdateProperty,
    handleGsapUpdateMeta,
    handleGsapDeleteAnimation,
    handleGsapAddAnimation,
    handleGsapAddProperty,
    handleGsapRemoveProperty,
    handleGsapUpdateFromProperty,
    handleGsapAddFromProperty,
    handleGsapRemoveFromProperty,
    commitAnimatedProperty,
    commitAnimatedProperties,
    handleSetArcPath,
    handleUpdateArcSegment,
    handleUnroll,
    handleUpdateKeyframeEase,
    handleUpdateSegmentEase,
    handleSetAllKeyframeEases,
    handleGsapAddKeyframe,
    handleGsapRemoveKeyframe,
    handleGsapConvertToKeyframes,
  } = useDomEditContext();

  const {
    assets,
    fontAssets,
    projectDir,
    handleImportFiles,
    handleImportFonts,
    refreshFileTree,
    readProjectFile,
    writeProjectFile,
    editingFile,
  } = useFileManagerContext();

  // Discrete ops (toggle, reorder, add/delete, hotspot): persist immediately,
  // no coalescing — each is a distinct user action that deserves its own undo entry.
  const onPersistSlideshow = useSlideshowPersist({
    sdkSession,
    activeCompPath,
    readProjectFile,
    writeProjectFile,
    recordEdit,
    reloadPreview,
    publishSdkSession,
  });

  // Notes path: persists are debounced in SlideshowPanel; coalesceKey ensures
  // rapid writes collapse into a single undo entry via the save-queue infra.
  const onPersistSlideshowNotes = useSlideshowPersist({
    sdkSession,
    activeCompPath,
    readProjectFile,
    writeProjectFile,
    recordEdit,
    reloadPreview,
    publishSdkSession,
    coalesceKey: activeCompPath ? `slideshow-notes:${activeCompPath}` : "slideshow-notes",
  });

  const renderJobs = renderQueue.jobs as RenderJob[];
  const slideshowVisible = useDockLayoutStore((state) => state.visiblePanels.has("slideshow"));
  const { isSlideshowComposition, slideshowScenes } = useSlideshowTabState({
    editingFileContent: editingFile?.content,
    previewIframeRef,
    refreshKey,
    slideshowVisible,
  });
  useSlideshowDockPanel(isSlideshowComposition);
  useBlockParamsDismissal({
    hasBlockParams: activeBlockParams != null,
    onDismiss: onDismissBlockParams,
  });
  useCaptionDesignFocus(captionEditMode);

  const handleApplyColorGradingScope = useApplyColorGradingScope(recordEdit, reloadPreview);

  const handleRemoveBackground = useRemoveBackground(projectId, refreshFileTree, showToast);

  /**
   * A dial being dragged writes to the preview and stops there.
   *
   * Every one of these panels previews on each pointermove and commits on
   * release. Persisting the moves too put a fragment of the drag in the undo
   * stack — and since those writes race, history could not coalesce them
   * reliably, so undo took back a sliver of the gesture rather than the gesture.
   * The release's own commit is what reaches the file and the undo stack.
   */
  const setAttributeWhileDragging = useCallback(
    (attr: string, value: string | null) =>
      handleDomAttributeLiveCommit(attr, value, undefined, { previewOnly: true }),
    [handleDomAttributeLiveCommit],
  );
  const handleHideAllSelected = useCallback(() => {
    // Audio has no visual to hide, and `data-hidden` on an audio element is what
    // mutes it — preview silences it and the render drops it from the mix; the
    // timeline offers that write as a mute. Checked here as well as in the panel
    // because the button is not the only caller.
    if (!canHideSelections(domEditGroupSelections)) {
      showToast("Audio can't be hidden. Use the group's own controls", "info");
      return;
    }
    const { elements } = usePlayerStore.getState();
    const keys = timelineKeysForSelections(domEditGroupSelections, elements, activeCompPath);
    if (keys.length > 0) void onToggleElementHidden?.(keys, true);
  }, [domEditGroupSelections, showToast, activeCompPath, onToggleElementHidden]);
  const convertToKeyframes = useCallback(
    (animId: string, duration?: number) =>
      handleGsapConvertToKeyframes(animId, undefined, duration),
    [handleGsapConvertToKeyframes],
  );
  const propertyPanel = (
    <DesignPanelPromoteProvider
      selection={domEditGroupSelections.length > 1 ? null : domEditSelection}
      projectId={projectId}
      activeCompPath={activeCompPath}
      showToast={showToast}
      readProjectFile={readProjectFile}
      writeProjectFile={writeProjectFile}
      recordEdit={recordEdit}
      reloadPreview={reloadPreview}
      forceReloadSharedSdkSession={forceReloadSdkSession}
    >
      <PropertyPanel
        projectId={projectId}
        projectDir={projectDir}
        assets={assets}
        element={domEditGroupSelections.length > 1 ? null : domEditSelection}
        multiSelectCount={domEditGroupSelections.length}
        multiSelectedElements={domEditGroupSelections}
        onGroupSelection={handleGroupSelection}
        onHideAllSelected={handleHideAllSelected}
        copiedAgentPrompt={copiedAgentPrompt}
        onClearSelection={clearDomSelection}
        onToggleElementHidden={onToggleElementHidden}
        onAutoGroupCarveSources={onAutoGroupCarveSources}
        onUngroup={handleUngroupSelection}
        onSetStyle={handleDomStyleCommit}
        onSetAttribute={handleDomAttributeCommit}
        onSetAttributes={handleDomAttributesCommit}
        onSetAttributeBatch={handleDomAttributeBatchCommit}
        onSetAttributeLive={setAttributeWhileDragging}
        onSetAttributeQuiet={handleDomAttributeQuietCommit}
        onApplyColorGradingScope={handleApplyColorGradingScope}
        onSetHtmlAttribute={handleDomHtmlAttributeCommit}
        onRemoveBackground={handleRemoveBackground}
        onSetManualOffset={handleDomPathOffsetCommit}
        onSetManualSize={handleDomBoxSizeCommit}
        onSetManualRotation={handleDomRotationCommit}
        onSetText={handleDomTextCommit}
        onSetTextFieldStyle={handleDomTextFieldStyleCommit}
        onAddTextField={handleDomAddTextField}
        onRemoveTextField={handleDomRemoveTextField}
        onAskAgent={handleAskAgent}
        onImportAssets={handleImportFiles}
        onAddMediaOverlay={onAddMediaOverlay}
        fontAssets={fontAssets}
        onImportFonts={handleImportFonts}
        previewIframeRef={previewIframeRef}
        gsapAnimations={selectedGsapAnimations}
        gsapMultipleTimelines={gsapMultipleTimelines}
        gsapUnsupportedTimelinePattern={gsapUnsupportedTimelinePattern}
        onUpdateGsapProperty={handleGsapUpdateProperty}
        onUpdateGsapMeta={handleGsapUpdateMeta}
        onDeleteGsapAnimation={handleGsapDeleteAnimation}
        onAddGsapProperty={handleGsapAddProperty}
        onRemoveGsapProperty={handleGsapRemoveProperty}
        onUpdateGsapFromProperty={handleGsapUpdateFromProperty}
        onAddGsapFromProperty={handleGsapAddFromProperty}
        onRemoveGsapFromProperty={handleGsapRemoveFromProperty}
        onAddGsapAnimation={handleGsapAddAnimation}
        onCommitAnimatedProperty={commitAnimatedProperty}
        onCommitAnimatedProperties={commitAnimatedProperties}
        onAddKeyframe={handleGsapAddKeyframe}
        onRemoveKeyframe={handleGsapRemoveKeyframe}
        onConvertToKeyframes={convertToKeyframes}
        onSeekToTime={seekToTime}
        onSetArcPath={handleSetArcPath}
        onUpdateArcSegment={handleUpdateArcSegment}
        onUnroll={handleUnroll}
        onUpdateKeyframeEase={handleUpdateKeyframeEase}
        onUpdateSegmentEase={handleUpdateSegmentEase}
        onSetAllKeyframeEases={handleSetAllKeyframeEases}
        recordingState={recordingState}
        recordingDuration={recordingDuration}
        onToggleRecording={onToggleRecording}
      />
    </DesignPanelPromoteProvider>
  );

  const { selectedMotionId, setSelectedMotionId, commitManifest } = useStudioMotionStore();

  useEffect(() => {
    return installHyperFramesAgentBridge({
      getManifest: () => useStudioMotionStore.getState().manifest,
      getActiveStylePreset: () => useStudioMotionStore.getState().activeStylePreset,
      getActiveCompPath: () => activeCompPath,
      getCurrentTime: () => usePlayerStore.getState().currentTime,
      getIframeDoc: () => previewIframeRef.current?.contentDocument ?? null,
      getTimelineElements: () => usePlayerStore.getState().elements,
      commitManifest: async (nextManifest, label) => {
        await commitManifest(nextManifest, label, {
          writeProjectFile,
          recordEdit,
          iframeDoc: previewIframeRef.current?.contentDocument ?? null,
          activeCompPath,
          currentTime: usePlayerStore.getState().currentTime,
        });
      },
      setSelectedMotionId,
      requestSeek: (t) => usePlayerStore.getState().requestSeek(t),
    });
  }, [
    activeCompPath,
    commitManifest,
    previewIframeRef,
    recordEdit,
    setSelectedMotionId,
    writeProjectFile,
  ]);

  // Auto-sync declarative HTML motion/transition attributes (data-transition, data-motion-in/out/emphasis/path)
  useEffect(() => {
    const doc = previewIframeRef.current?.contentDocument ?? null;
    if (!doc) return;
    const state = useStudioMotionStore.getState();
    const { manifest: synced, addedCount } = syncDeclarativeDomMotions(
      doc,
      activeCompPath,
      state.manifest,
      state.activeStylePreset,
    );
    if (addedCount > 0) {
      state.setManifestLive(synced, doc, activeCompPath, usePlayerStore.getState().currentTime);
    }
  }, [activeCompPath, previewIframeRef, refreshKey]);
  const selectedTimelineElement = usePlayerStore((s) =>
    s.elements.find((el) => {
      const key = el.key ?? el.id;
      return s.selectedElementIds instanceof Set
        ? s.selectedElementIds.has(key) || s.selectedElementIds.has(el.id)
        : Array.isArray(s.selectedElementIds) &&
            ((s.selectedElementIds as string[]).includes(key) ||
              (s.selectedElementIds as string[]).includes(el.id));
    }),
  );

  const hasSingleSelection =
    (Boolean(domEditSelection) || Boolean(selectedTimelineElement)) &&
    domEditGroupSelections.length <= 1;

  const handleDeleteCurrentSelection = useCallback(() => {
    if (domEditSelection) {
      void handleDomEditElementDelete(domEditSelection);
    } else if (selectedTimelineElement) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    }
  }, [domEditSelection, handleDomEditElementDelete, selectedTimelineElement]);

  const handleToggleCurrentHidden = useCallback(
    (nextHidden: boolean) => {
      if (selectedTimelineElement && onToggleElementHidden) {
        void onToggleElementHidden(
          [selectedTimelineElement.key ?? selectedTimelineElement.id],
          nextHidden,
        );
        return;
      }
      if (domEditSelection) {
        const { elements } = usePlayerStore.getState();
        const keys = timelineKeysForSelections([domEditSelection], elements, activeCompPath);
        if (keys.length > 0 && onToggleElementHidden) {
          void onToggleElementHidden(keys, nextHidden);
          return;
        }
      }
      void handleDomAttributeQuietCommit("hidden", nextHidden ? "" : null);
    },
    [
      activeCompPath,
      domEditSelection,
      handleDomAttributeQuietCommit,
      onToggleElementHidden,
      selectedTimelineElement,
    ],
  );

  let designBody = (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {hasSingleSelection && (
        <InspectorLayerActions
          selection={domEditSelection}
          timelineElement={selectedTimelineElement}
          gsapAnimations={selectedGsapAnimations}
          onDeleteLayer={handleDeleteCurrentSelection}
          onDeleteScene={handleDeleteCurrentSelection}
          onToggleHidden={handleToggleCurrentHidden}
        />
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {domEditSelection || domEditGroupSelections.length > 1 || !selectedTimelineElement ? (
          propertyPanel
        ) : (
          <div
            data-testid="inspector-timeline-clip-properties"
            className="flex flex-col gap-3 p-3.5 text-xs text-neutral-200"
          >
            <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              {selectedTimelineElement.type === "scene" ||
              Boolean(selectedTimelineElement.compositionSrc)
                ? "Scene Clip Properties"
                : "Layer Clip Properties"}
            </div>
            <div className="grid grid-cols-2 gap-2 rounded-lg border border-neutral-800 bg-neutral-900/60 p-3">
              <div>
                <div className="text-[10px] text-neutral-500">Clip ID</div>
                <div className="font-mono text-xs text-neutral-100">
                  #{selectedTimelineElement.domId || selectedTimelineElement.id}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-neutral-500">Track</div>
                <div className="font-mono text-xs text-neutral-100">
                  Track {(selectedTimelineElement.track ?? 0) + 1}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-neutral-500">Start Time</div>
                <div className="font-mono text-xs text-neutral-100">
                  {selectedTimelineElement.start.toFixed(2)}s
                </div>
              </div>
              <div>
                <div className="text-[10px] text-neutral-500">Duration</div>
                <div className="font-mono text-xs text-neutral-100">
                  {selectedTimelineElement.duration.toFixed(2)}s
                </div>
              </div>
              {selectedTimelineElement.textContent && (
                <div className="col-span-2">
                  <div className="text-[10px] text-neutral-500">Text Content</div>
                  <div className="text-xs font-medium text-neutral-100 truncate">
                    {selectedTimelineElement.textContent}
                  </div>
                </div>
              )}
              <div className="col-span-2">
                <div className="text-[10px] text-neutral-500">Composition Source</div>
                <div className="font-mono text-[11px] text-emerald-300 truncate">
                  {selectedTimelineElement.compositionSrc ||
                    selectedTimelineElement.sourceFile ||
                    "index.html"}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
  if (selectedMotionId) {
    designBody = <MotionInspector onClose={() => setSelectedMotionId(null)} />;
  } else if (captionEditMode) {
    designBody = <CaptionPropertyPanel iframeRef={previewIframeRef} />;
  } else if (activeBlockParams) {
    designBody = (
      <BlockParamsPanel
        blockName={activeBlockParams.blockName}
        blockTitle={activeBlockParams.blockTitle}
        params={activeBlockParams.params}
        compositionPath={activeBlockParams.compositionPath}
        onClose={onCloseBlockParams ?? (() => {})}
      />
    );
  } else if (!domEditSelection && !selectedTimelineElement && domEditGroupSelections.length === 0) {
    designBody = (
      <ProjectSettingsInspector
        projectId={projectId}
        projectDir={projectDir}
        activeCompPath={activeCompPath}
        onOpenAssistant={() => useDockLayoutStore.getState().activatePanel("assistant")}
      />
    );
  }

  return (
    <>
      <Dock.Panel id="design" title={selectedMotionId ? "Motion Inspector" : "Inspector"}>
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <RightInspectorHeader activePanelId="design" renderCount={renderJobs.length} />
          <div className="min-h-0 flex-1 overflow-hidden">{designBody}</div>
        </div>
      </Dock.Panel>
      <Dock.Panel id="layers">
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <RightInspectorHeader activePanelId="layers" renderCount={renderJobs.length} />
          <div className="min-h-0 flex-1 overflow-hidden">
            <LayersPanel />
          </div>
        </div>
      </Dock.Panel>
      <Dock.Panel id="assistant" title="🤖 Assistant">
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <RightInspectorHeader activePanelId="assistant" renderCount={renderJobs.length} />
          <div className="min-h-0 flex-1 overflow-hidden">
            <AgentAssistantPanel
              projectId={projectId}
              activeCompPath={activeCompPath}
              selectedElementId={domEditSelection?.id || domEditSelection?.hfId || null}
              reloadPreview={reloadPreview}
              refreshFileTree={refreshFileTree}
            />
          </div>
        </div>
      </Dock.Panel>
      <Dock.Panel id="handoff" title="📋 Handoff">
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <RightInspectorHeader activePanelId="handoff" renderCount={renderJobs.length} />
          <div className="min-h-0 flex-1 overflow-hidden">
            <EpisodeHandoffPanel projectId={projectId} />
          </div>
        </div>
      </Dock.Panel>
      <Dock.Panel
        id="renders"
        title={renderJobs.length > 0 ? `Renders (${renderJobs.length})` : undefined}
      >
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <RightInspectorHeader activePanelId="renders" renderCount={renderJobs.length} />
          <div className="min-h-0 flex-1 overflow-hidden">
            <RenderQueuePanel />
          </div>
        </div>
      </Dock.Panel>
      <Dock.Panel id="variables">
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <RightInspectorHeader activePanelId="variables" renderCount={renderJobs.length} />
          <div className="min-h-0 flex-1 overflow-hidden">
            <VariablesPanel
              sdkSession={sdkSession}
              publishSdkSession={publishSdkSession}
              reloadPreview={reloadPreview}
              recordEdit={recordEdit}
            />
          </div>
        </div>
      </Dock.Panel>
      <Dock.Panel id="motionBlur">
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <RightInspectorHeader activePanelId="motionBlur" renderCount={renderJobs.length} />
          <div className="min-h-0 flex-1 overflow-hidden">
            <MotionBlurPanel
              sdkSession={sdkSession}
              publishSdkSession={publishSdkSession}
              reloadPreview={reloadPreview}
              recordEdit={recordEdit}
            />
          </div>
        </div>
      </Dock.Panel>
      <Dock.Panel id="slideshow">
        <SlideshowPanel
          scenes={slideshowScenes}
          onPersist={onPersistSlideshow}
          onPersistNotes={onPersistSlideshowNotes}
        />
      </Dock.Panel>
    </>
  );
});
