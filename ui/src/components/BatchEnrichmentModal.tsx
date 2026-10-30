import React from "react";
import { useEnrichmentStore } from "../stores/enrichmentStore";
import {
  Sparkles,
  X,
  Play,
  Pause,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sliders,
  Check,
} from "lucide-react";

export const BatchEnrichmentModal: React.FC = () => {
  const {
    isOpen,
    isRunning,
    isPaused,
    total,
    completed,
    successCount,
    skippedCount,
    failedCount,
    currentTrackTitle,
    log,
    options,
    closeModal,
    setOptions,
    startEnrichment,
    pauseEnrichment,
    resumeEnrichment,
    cancelEnrichment,
  } = useEnrichmentStore();

  if (!isOpen) return null;

  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const isFinished = !isRunning && completed > 0 && completed === total;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div
        className="bg-surface/95 backdrop-blur-xl border border-white/[0.08] w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden animate-scaleUp"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] flex-shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                Batch Metadata & Lyrics Enrichment
                <span className="text-2xs font-normal px-2 py-1 rounded-full bg-white/[0.06] text-textSecondary">
                  {total} {total === 1 ? "track" : "tracks"}
                </span>
              </h2>
              <p className="text-xs text-textMuted">
                Auto-fill artwork, tags, and synced lyrics from Apple Music & LRCLIB
              </p>
            </div>
          </div>
          <button
            onClick={closeModal}
            disabled={isRunning}
            className="p-2 rounded-lg text-textMuted hover:text-white hover:bg-white/[0.06] transition disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {/* Options Configuration (available when idle) */}
          {!isRunning && !isFinished && (
            <div className="bg-deck/60 border border-white/[0.06] rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-textSecondary uppercase tracking-wider flex items-center gap-2">
                  <Sliders className="w-3.5 h-3.5" />
                  Enrichment Options
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <label className="flex items-center space-x-3 cursor-pointer select-none text-textSecondary hover:text-white transition">
                  <input
                    type="checkbox"
                    checked={options.fetchMetadata}
                    onChange={(e) => setOptions({ fetchMetadata: e.target.checked })}
                    className="w-4 h-4 rounded bg-surface border-white/[0.12] text-accent accent-accent"
                  />
                  <span>Release Year, Genre, Track #</span>
                </label>

                <label className="flex items-center space-x-3 cursor-pointer select-none text-textSecondary hover:text-white transition">
                  <input
                    type="checkbox"
                    checked={options.fetchLyrics}
                    onChange={(e) => setOptions({ fetchLyrics: e.target.checked })}
                    className="w-4 h-4 rounded bg-surface border-white/[0.12] text-accent accent-accent"
                  />
                  <span>Time-Synced & Plain Lyrics</span>
                </label>

                <label className="flex items-center space-x-3 cursor-pointer select-none text-textSecondary hover:text-white transition">
                  <input
                    type="checkbox"
                    checked={options.writeTags}
                    onChange={(e) => setOptions({ writeTags: e.target.checked })}
                    className="w-4 h-4 rounded bg-surface border-white/[0.12] text-accent accent-accent"
                  />
                  <span>Write tags to audio files</span>
                </label>

                <label className="flex items-center space-x-3 cursor-pointer select-none text-textSecondary hover:text-white transition">
                  <input
                    type="checkbox"
                    checked={options.overwriteExisting}
                    onChange={(e) => setOptions({ overwriteExisting: e.target.checked })}
                    className="w-4 h-4 rounded bg-surface border-white/[0.12] text-accent accent-accent"
                  />
                  <span>Overwrite existing tags</span>
                </label>
              </div>
            </div>
          )}

          {/* Progress Section */}
          {(isRunning || completed > 0) && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-white">
                  {isFinished ? "Enrichment Complete" : isRunning ? (isPaused ? "Paused" : "Processing...") : "Ready"}
                </span>
                <span className="text-textSecondary font-mono">
                  {completed} / {total} ({percent}%)
                </span>
              </div>

              {/* Progress Bar */}
              <div className="w-full h-2.5 bg-deck rounded-full overflow-hidden border border-white/[0.04]">
                <div
                  className="h-full bg-accent transition-all duration-300 ease-out"
                  style={{ width: `${percent}%` }}
                />
              </div>

              {/* Active Item Indicator */}
              {isRunning && currentTrackTitle && (
                <div className="text-2xs text-textMuted truncate flex items-center gap-2">
                  <Clock className="w-3 h-3 text-accent animate-pulse" />
                  <span>Current: {currentTrackTitle}</span>
                </div>
              )}

              {/* Counters */}
              <div className="flex items-center gap-4 text-2xs pt-1 text-textMuted">
                <span className="flex items-center gap-1 text-emerald-400">
                  <CheckCircle2 className="w-3 h-3" />
                  {successCount} updated
                </span>
                <span className="flex items-center gap-1 text-textSecondary">
                  {skippedCount} unchanged
                </span>
                {failedCount > 0 && (
                  <span className="flex items-center gap-1 text-rose-400">
                    <AlertCircle className="w-3 h-3" />
                    {failedCount} failed
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Live Activity Log */}
          {log.length > 0 && (
            <div className="space-y-2">
              <span className="text-2xs font-semibold text-textMuted uppercase tracking-wider">
                Activity Stream
              </span>
              <div className="bg-deck/70 border border-white/[0.06] rounded-xl p-3 max-h-48 overflow-y-auto space-y-2 font-mono text-xs">
                {log.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-start justify-between gap-2 py-1 border-b border-white/[0.02] last:border-0"
                  >
                    <div className="min-w-0">
                      <div className="text-white truncate font-medium">{item.title}</div>
                      <div className="text-textMuted text-2xs truncate">{item.artist}</div>
                    </div>
                    <div className="flex-shrink-0 flex items-center gap-2 text-2xs">
                      {item.status === "success" ? (
                        <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          {item.details.join(", ")}
                        </span>
                      ) : item.status === "skipped" ? (
                        <span className="px-2 py-1 rounded bg-white/[0.04] text-textMuted">
                          Skipped
                        </span>
                      ) : (
                        <span className="px-2 py-1 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20">
                          Failed
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-white/[0.06] bg-surfaceHover/50 flex items-center justify-between gap-3 flex-shrink-0">
          <div className="text-2xs text-textMuted">
            {isRunning
              ? "Running in background • Safe to minimize"
              : isFinished
              ? "All tracks successfully processed."
              : "Grouped by album for maximum efficiency."}
          </div>

          <div className="flex items-center space-x-3">
            {isRunning ? (
              <>
                <button
                  type="button"
                  onClick={isPaused ? resumeEnrichment : pauseEnrichment}
                  className="inline-flex items-center gap-2 px-3 py-1 rounded-xl text-xs font-medium text-white bg-white/[0.08] hover:bg-white/[0.14] transition"
                >
                  {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                  <span>{isPaused ? "Resume" : "Pause"}</span>
                </button>
                <button
                  type="button"
                  onClick={cancelEnrichment}
                  className="px-3 py-1 rounded-xl text-xs font-medium text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 transition"
                >
                  Cancel
                </button>
              </>
            ) : isFinished ? (
              <button
                type="button"
                onClick={closeModal}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-accent-fill hover:bg-accentHover transition shadow-lg shadow-accent/20"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Done</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-textSecondary hover:text-white bg-white/[0.04] hover:bg-white/[0.08] transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void startEnrichment()}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-semibold text-white bg-accent-fill hover:bg-accentHover active:scale-98 transition shadow-lg shadow-accent/20"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Start Mass Fill</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
