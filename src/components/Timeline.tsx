import React from 'react';
import { Play, Pause, ChevronLeft, ChevronRight } from 'lucide-react';

interface TimelineProps {
  currentTime: number;
  inTime: number;
  outTime: number;
  duration: number;
  isPlaying: boolean;
  /** Video FPS from ffprobe; used for frame snap and frame step */
  fps?: number;
  onCurrentTimeChange: (time: number) => void;
  onInTimeChange: (time: number) => void;
  onOutTimeChange: (time: number) => void;
  onPlayPause: () => void;
  onExport: () => void;
  formatTime: (seconds: number) => string;
}

const MIN_GAP = 0.001;

function snapToFrame(seconds: number, fps: number): number {
  const f = fps > 0 ? fps : 30;
  return Math.round(seconds * f) / f;
}

const Timeline: React.FC<TimelineProps> = ({
  currentTime,
  inTime,
  outTime,
  duration,
  isPlaying,
  fps: fpsProp,
  onCurrentTimeChange,
  onInTimeChange,
  onOutTimeChange,
  onPlayPause,
  onExport,
  formatTime
}) => {
  const fps = Number.isFinite(fpsProp) && (fpsProp ?? 0) > 0 ? fpsProp! : 30;
  const frameTime = 1 / fps;

  const trackRef = React.useRef<HTMLDivElement>(null);
  const [drag, setDrag] = React.useState<null | 'playhead' | 'in' | 'out'>(null);

  const parseTimecode = React.useCallback((raw: string): number | null => {
    const s = raw.trim();
    if (!s) return null;
    if (/^\d+(\.\d+)?$/.test(s)) return Number(s);

    const parts = s.split(':').map(p => p.trim());
    if (parts.length > 3) return null;
    const [hh, mm, ssRaw] =
      parts.length === 3 ? parts :
      parts.length === 2 ? ['0', ...parts] :
      ['0', '0', parts[0]];

    const [ss, msRaw = '0'] = ssRaw.split('.');
    const hours = Number(hh);
    const minutes = Number(mm);
    const seconds = Number(ss || '0');
    const ms = Number(msRaw.padEnd(3, '0').slice(0, 3));
    if (![hours, minutes, seconds, ms].every(Number.isFinite)) return null;
    return hours * 3600 + minutes * 60 + seconds + ms / 1000;
  }, []);

  const [inText, setInText] = React.useState(() => formatTime(inTime));
  const [outText, setOutText] = React.useState(() => formatTime(outTime));

  React.useEffect(() => setInText(formatTime(inTime)), [formatTime, inTime]);
  React.useEffect(() => setOutText(formatTime(outTime)), [formatTime, outTime]);

  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 1;

  const xToTime = React.useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const pct = (clientX - rect.left) / rect.width;
      return Math.max(0, Math.min(safeDuration, pct * safeDuration));
    },
    [safeDuration]
  );

  const applySnap = React.useCallback(
    (t: number, shiftKey: boolean) => (shiftKey ? t : snapToFrame(t, fps)),
    [fps]
  );

  React.useEffect(() => {
    if (!drag) return;

    const onMove = (e: PointerEvent) => {
      const tRaw = xToTime(e.clientX);
      const t = applySnap(tRaw, e.shiftKey);

      if (drag === 'playhead') {
        onCurrentTimeChange(Math.max(0, Math.min(safeDuration, t)));
        return;
      }
      if (drag === 'in') {
        const maxIn = Math.max(0, outTime - MIN_GAP);
        onInTimeChange(Math.min(maxIn, t));
        return;
      }
      if (drag === 'out') {
        const minOut = Math.min(safeDuration, inTime + MIN_GAP);
        onOutTimeChange(Math.max(minOut, t));
      }
    };

    const onUp = () => setDrag(null);

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [applySnap, drag, inTime, onCurrentTimeChange, onInTimeChange, onOutTimeChange, outTime, safeDuration, xToTime]);

  const handleTrackPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setDrag('playhead');
    const tRaw = xToTime(e.clientX);
    const t = applySnap(tRaw, e.shiftKey);
    onCurrentTimeChange(Math.max(0, Math.min(safeDuration, t)));
  };

  const startDrag = (kind: 'playhead' | 'in' | 'out') => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDrag(kind);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const handleFrameStep = (direction: 'forward' | 'backward') => {
    const delta = direction === 'forward' ? frameTime : -frameTime;
    const newTime =
      direction === 'forward'
        ? Math.min(safeDuration, currentTime + delta)
        : Math.max(0, currentTime + delta);
    onCurrentTimeChange(snapToFrame(newTime, fps));
  };

  const commitIn = () => {
    const parsed = parseTimecode(inText);
    if (parsed == null) {
      setInText(formatTime(inTime));
      return;
    }
    onInTimeChange(parsed);
  };

  const commitOut = () => {
    const parsed = parseTimecode(outText);
    if (parsed == null) {
      setOutText(formatTime(outTime));
      return;
    }
    onOutTimeChange(parsed);
  };

  const currentPercentage = (currentTime / safeDuration) * 100;
  const inPercentage = (inTime / safeDuration) * 100;
  const outPercentage = (outTime / safeDuration) * 100;

  return (
    <div className="bg-slate-800 border-t border-slate-600">
      <div className="relative px-6 py-4">
        <div className="mb-4">
          <div
            ref={trackRef}
            className="h-8 bg-slate-600 rounded relative select-none touch-none"
          >
            {/* Scrub layer (behind handles) */}
            <button
              type="button"
              aria-label="Seek timeline"
              className="absolute inset-0 z-0 rounded cursor-pointer border-0 bg-transparent p-0"
              onPointerDown={handleTrackPointerDown}
            />

            {/* Selection range */}
            <div
              className="pointer-events-none absolute inset-y-0 bg-blue-500/30 rounded"
              style={{
                left: `${inPercentage}%`,
                width: `${Math.max(0, outPercentage - inPercentage)}%`
              }}
            />

            {/* Timeline ticks */}
            <div className="pointer-events-none absolute inset-0 flex">
              {Array.from({ length: 21 }, (_, i) => (
                <div
                  key={i}
                  className="flex-1 border-l border-slate-500 first:border-l-0"
                  style={{ height: i % 5 === 0 ? '100%' : '50%' }}
                />
              ))}
            </div>

            {/* In handle */}
            <div
              role="slider"
              aria-label="Trim in"
              tabIndex={0}
              className="absolute top-1/2 z-20 flex h-10 w-3 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center"
              style={{ left: `${inPercentage}%` }}
              onPointerDown={startDrag('in')}
            >
              <div className="h-8 w-1 rounded-sm bg-amber-400 shadow" />
            </div>

            {/* Out handle */}
            <div
              role="slider"
              aria-label="Trim out"
              tabIndex={0}
              className="absolute top-1/2 z-20 flex h-10 w-3 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center"
              style={{ left: `${outPercentage}%` }}
              onPointerDown={startDrag('out')}
            >
              <div className="h-8 w-1 rounded-sm bg-amber-400 shadow" />
            </div>

            {/* Playhead */}
            <div
              role="slider"
              aria-label="Playhead"
              tabIndex={0}
              className="absolute top-1/2 z-30 flex h-10 w-4 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center active:cursor-grabbing"
              style={{ left: `${currentPercentage}%` }}
              onPointerDown={startDrag('playhead')}
            >
              <div className="h-10 w-0.5 rounded-sm bg-blue-400 shadow" />
            </div>

            <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded bg-black/60 px-3 py-1 font-mono text-sm text-white backdrop-blur-sm">
              {formatTime(currentTime)}
            </div>
          </div>
          <p className="mt-1 text-center text-[10px] text-slate-500">
            Drag handles · Hold Shift to disable frame snap ({fps.toFixed(2)} fps)
          </p>
        </div>

        <div className="relative flex items-center justify-center space-x-4">
          <input
            type="text"
            value={inText}
            onChange={(e) => setInText(e.target.value)}
            onBlur={commitIn}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitIn();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setInText(formatTime(inTime));
              }
            }}
            className="w-28 rounded border border-slate-600 bg-slate-700 px-2 py-1 text-center text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          <button
            type="button"
            onClick={() => handleFrameStep('backward')}
            className="flex h-8 w-8 items-center justify-center rounded bg-slate-700 transition-colors hover:bg-slate-600"
            title="Previous frame"
          >
            <ChevronLeft size={16} className="text-white" />
          </button>

          <button
            type="button"
            onClick={onPlayPause}
            className="btn-hover-scale flex h-12 w-12 items-center justify-center rounded-full bg-blue-500 hover:bg-blue-600"
          >
            {isPlaying ? (
              <Pause size={20} className="text-white" />
            ) : (
              <Play size={20} className="ml-0.5 text-white" />
            )}
          </button>

          <button
            type="button"
            onClick={() => handleFrameStep('forward')}
            className="flex h-8 w-8 items-center justify-center rounded bg-slate-700 transition-colors hover:bg-slate-600"
            title="Next frame"
          >
            <ChevronRight size={16} className="text-white" />
          </button>

          <input
            type="text"
            value={outText}
            onChange={(e) => setOutText(e.target.value)}
            onBlur={commitOut}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitOut();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setOutText(formatTime(outTime));
              }
            }}
            className="w-28 rounded border border-slate-600 bg-slate-700 px-2 py-1 text-center text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="absolute bottom-4 right-6">
        <button
          type="button"
          onClick={onExport}
          className="btn-hover-scale rounded-lg bg-blue-500 px-6 py-2 font-medium text-white transition-colors hover:bg-blue-600"
        >
          Export
        </button>
      </div>
    </div>
  );
};

export default Timeline;
