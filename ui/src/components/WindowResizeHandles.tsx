import React from "react";
import { windowService, useWindowState, ResizeDirection } from "../services/windowService";
import { isTauri } from "../services/adapter";

interface ResizeEdgeProps {
  direction: ResizeDirection;
  className: string;
}

const ResizeEdge: React.FC<ResizeEdgeProps> = ({ direction, className }) => {
  const handlePointerDown = (e: React.PointerEvent) => {
    // Only respond to primary mouse button
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    windowService.startResize(direction);
  };

  return (
    <div
      data-tauri-drag-region="none"
      onPointerDown={handlePointerDown}
      className={`fixed z-50 select-none ${className}`}
      aria-hidden="true"
    />
  );
};

export const WindowResizeHandles: React.FC = () => {
  // Only desktop Tauri mode requires client-side resize handles
  if (!isTauri) return null;

  const { isMaximized, isFullscreen } = useWindowState();

  // If maximized or in fullscreen mode, window cannot be resized
  if (isMaximized || isFullscreen) return null;

  return (
    <>
      {/* Subtle 1px window perimeter outline for frameless window definition */}
      <div className="fixed inset-0 pointer-events-none border border-white/[0.08] z-40" aria-hidden="true" />

      {/* 4 Cardinal Edges (6px thickness) */}
      <ResizeEdge direction="North" className="top-0 left-3 right-3 h-1.5 cursor-n-resize" />
      <ResizeEdge direction="South" className="bottom-0 left-3 right-3 h-1.5 cursor-s-resize" />
      <ResizeEdge direction="West" className="top-3 bottom-3 left-0 w-1.5 cursor-w-resize" />
      <ResizeEdge direction="East" className="top-3 bottom-3 right-0 w-1.5 cursor-e-resize" />

      {/* 4 Corners (12px x 12px) */}
      <ResizeEdge direction="NorthWest" className="top-0 left-0 w-3 h-3 cursor-nw-resize" />
      <ResizeEdge direction="NorthEast" className="top-0 right-0 w-3 h-3 cursor-ne-resize" />
      <ResizeEdge direction="SouthWest" className="bottom-0 left-0 w-3 h-3 cursor-sw-resize" />
      <ResizeEdge direction="SouthEast" className="bottom-0 right-0 w-3 h-3 cursor-se-resize" />
    </>
  );
};
