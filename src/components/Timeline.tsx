import React from 'react';
import { Play, Pause, ChevronLeft, ChevronRight, Plus, ArrowUpRight } from 'lucide-react';

import type { ProjectSegment } from '../types/electron';
import { unwrapIpc } from '../utils/ipc';

interface TimelineProps {
  sourcePath?: string;
  segments?: ProjectSegment[];
  activeSegmentId?: string;
  onSelectSegment?: (id: string) => void;
  onAddSegment?: () => void;
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
  sourcePath,
  segments = [], activeSegmentId, onSelectSegment, onAddSegment,
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
  const [keyframes, setKeyframes] = React.useState<number[]>([]);
  const [keyframeNote, setKeyframeNote] = React.useState('');
  React.useEffect(() => {
    setKeyframes([]);
    if (!sourcePath || !window.electronAPI?.getKeyframes) return;
    let active = true;
    const timer = setTimeout(() => {
      window.electronAPI.getKeyframes(sourcePath, inTime).then(unwrapIpc).then(result => {
        if (active) { setKeyframes(result.times); setKeyframeNote('Keyframe ticks near IN; fast export adjusts to keyframe boundaries.'); }
      }).catch(() => { if (active) setKeyframeNote('Keyframes unavailable; exact export is still available.'); });
    }, 400);
    return () => { active = false; clearTimeout(timer); };
  }, [sourcePath, inTime]);

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
    if (e.button !== 0 || duration <= 0) return;
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
    if (isPlaying) onPlayPause();
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

  const enabled = duration > 0;
  const activeIndex = segments.findIndex(segment => segment.id === activeSegmentId);
  const sliderKey = (kind: 'playhead' | 'in' | 'out', e: React.KeyboardEvent) => {
    if (!enabled || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    const value = kind === 'in' ? inTime : kind === 'out' ? outTime : currentTime;
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? duration : value + (e.key === 'ArrowRight' ? frameTime : -frameTime);
    if (kind === 'in') onInTimeChange(Math.max(0, Math.min(outTime, next)));
    else if (kind === 'out') onOutTimeChange(Math.min(duration, Math.max(inTime, next)));
    else onCurrentTimeChange(Math.max(0, Math.min(duration, next)));
  };
  return <section className="timeline" aria-label="Clip timeline">
    <div className="timeline-heading">
      <div className="timeline-clips"><span className="eyebrow">TIMELINE</span>
        {segments.map((segment, index) => <button key={segment.id} className={`clip-tab ${segment.id === activeSegmentId ? 'active' : ''}`} aria-pressed={segment.id === activeSegmentId} onClick={() => onSelectSegment?.(segment.id)} title={segment.name}>Clip {String(index + 1).padStart(2, '0')}</button>)}
        <button className="icon-button" onClick={onAddSegment} disabled={!enabled} title="Add clip from current range" aria-label="Add clip"><Plus size={14} /></button>
      </div>
      <span className="timeline-help" title={keyframeNote}>Drag edges to trim <span> / </span> Shift for free positioning{keyframes.length > 0 ? ' / Keyframe ticks near IN' : ''}</span>
    </div>
    <div className="timeline-ruler" aria-hidden="true">{[0, 1, 2, 3, 4].map(i => <span key={i}>{formatTime(duration * i / 4).slice(0, 8)}</span>)}</div>
    <div ref={trackRef} className={`timeline-track ${enabled ? '' : 'empty'}`}>
      <button type="button" aria-label="Seek timeline" className="scrub-layer" disabled={!enabled} onPointerDown={handleTrackPointerDown}
        onKeyDown={e => sliderKey('playhead', e)} />
      <div className="range-fill" style={{ left: `${inPercentage}%`, width: `${Math.max(0, outPercentage - inPercentage)}%` }}>
        {enabled && <span>CLIP {String(activeIndex + 1).padStart(2, '0')} <span className="range-duration">{formatTime(outTime - inTime)}</span></span>}
      </div>
      {keyframes.filter((_, index) => index % Math.max(1, Math.ceil(keyframes.length / 40)) === 0).map(time =>
        <i key={time} aria-hidden="true" style={{ position: 'absolute', pointerEvents: 'none', left: `${time / safeDuration * 100}%`, bottom: 0, height: 6, width: 1, background: 'var(--accent)', opacity: 0.55 }} />)}
      {enabled && <>
        <div role="slider" aria-label="Trim in" aria-valuemin={0} aria-valuemax={outTime} aria-valuenow={inTime} aria-valuetext={formatTime(inTime)} tabIndex={0}
          className="trim-handle in-handle" style={{ left: `${inPercentage}%` }} onPointerDown={startDrag('in')} onKeyDown={e => sliderKey('in', e)} title="In point: drag or use arrow keys"><span /></div>
        <div role="slider" aria-label="Trim out" aria-valuemin={inTime} aria-valuemax={duration} aria-valuenow={outTime} aria-valuetext={formatTime(outTime)} tabIndex={0}
          className="trim-handle out-handle" style={{ left: `${outPercentage}%` }} onPointerDown={startDrag('out')} onKeyDown={e => sliderKey('out', e)} title="Out point: drag or use arrow keys"><span /></div>
        <div role="slider" aria-label="Playhead" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={currentTime} aria-valuetext={formatTime(currentTime)} tabIndex={0}
          className="playhead" style={{ left: `${currentPercentage}%` }} onPointerDown={startDrag('playhead')} onKeyDown={e => sliderKey('playhead', e)} title="Playhead"><i /></div>
      </>}
    </div>
    <div className="transport">
      <div className="transport-play">
        <button className="icon-button" onClick={() => handleFrameStep('backward')} disabled={!enabled} title="Previous frame (,)" aria-label="Previous frame"><ChevronLeft size={18} /></button>
        <button className="play-button" onClick={onPlayPause} disabled={!enabled} title="Play / pause (Space)" aria-label={isPlaying ? 'Pause' : 'Play'}>{isPlaying ? <Pause size={17} /> : <Play size={17} />}</button>
        <button className="icon-button" onClick={() => handleFrameStep('forward')} disabled={!enabled} title="Next frame (.)" aria-label="Next frame"><ChevronRight size={18} /></button>
        <span className="play-time mono">{formatTime(currentTime)}<small> / {formatTime(duration)}</small></span>
      </div>
      <div className="range-inputs">
        <label className="time-field"><button onClick={() => onInTimeChange(currentTime)} disabled={!enabled} title="Set in at playhead (I)">IN</button>
          <input aria-label="In point" value={inText} disabled={!enabled} onChange={e => setInText(e.target.value)} onBlur={commitIn} onKeyDown={e => { if (e.key === 'Enter') commitIn(); if (e.key === 'Escape') setInText(formatTime(inTime)); }} /></label>
        <span className="range-separator">/</span>
        <label className="time-field"><button onClick={() => onOutTimeChange(currentTime)} disabled={!enabled} title="Set out at playhead (O)">OUT</button>
          <input aria-label="Out point" value={outText} disabled={!enabled} onChange={e => setOutText(e.target.value)} onBlur={commitOut} onKeyDown={e => { if (e.key === 'Enter') commitOut(); if (e.key === 'Escape') setOutText(formatTime(outTime)); }} /></label>
      </div>
      <button className="primary-button export-clip" onClick={onExport} disabled={!enabled || outTime <= inTime} title="Export only the active clip">Export clip <ArrowUpRight size={16} /></button>
    </div>
  </section>;
};
export default Timeline;
