interface TimelineToolbarProps {
  clipId: string;
  fps: number;
  durationFrames: number;
  pixelsPerFrame: number;
  onPixelsPerFrameChange: (value: number) => void;
}

export function TimelineToolbar({
  clipId,
  fps,
  durationFrames,
  pixelsPerFrame,
  onPixelsPerFrameChange,
}: TimelineToolbarProps) {
  return (
    <div className="timeline-toolbar">
      <strong>{clipId}</strong>
      <span>{fps} fps · 0—{durationFrames}</span>
      <label className="timeline-zoom-control">
        缩放
        <input
          type="range"
          min="4"
          max="24"
          value={pixelsPerFrame}
          onChange={(event) => onPixelsPerFrameChange(Number(event.target.value))}
        />
      </label>
    </div>
  );
}
