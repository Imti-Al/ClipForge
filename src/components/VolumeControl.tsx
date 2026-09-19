import React from 'react';
import { Volume1, Volume2, VolumeX } from 'lucide-react';

interface VolumeControlProps {
  volume: number;
  muted: boolean;
  onChange: (volume: number) => void;
  onToggle: () => void;
}

export default function VolumeControl({ volume, muted, onChange, onToggle }: VolumeControlProps) {
  const control = React.useRef<HTMLDivElement>(null);
  const level = React.useRef(volume);
  level.current = muted ? 0 : volume;
  React.useEffect(() => {
    const element = control.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault(); event.stopPropagation();
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1);
      if (!pixels) return;
      level.current = Math.max(0, Math.min(1, level.current - pixels / 2000));
      onChange(level.current);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [onChange]);
  const silent = muted || volume === 0;
  const Icon = silent ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  return <div ref={control} className="preview-volume" onKeyDown={event => {
    if (event.key.toLowerCase() === 'm' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault(); event.stopPropagation(); onToggle();
    }
  }}>
    <button className="icon-button" onClick={onToggle} aria-label={silent ? 'Unmute preview' : 'Mute preview'} aria-pressed={silent}
      title={`${silent ? 'Unmute' : 'Mute'} preview (M). Volume: Up/Down or mouse wheel.`}><Icon size={17} /></button>
    <div className="volume-slider">
      <input type="range" aria-label="Preview volume" aria-valuetext={`${Math.round((silent ? 0 : volume) * 100)}%`}
        min="0" max="100" step="1" value={silent ? 0 : volume * 100}
        onChange={event => onChange(Number(event.target.value) / 100)} />
    </div>
  </div>;
}
