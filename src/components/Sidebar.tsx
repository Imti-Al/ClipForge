import React from 'react';
import { Plus, Trash2, ChevronRight } from 'lucide-react';
import type { ProjectSegment, VideoInfo } from '../types/electron';

interface SidebarProps {
  videoInfo: VideoInfo | null;
  inTime: number;
  outTime: number;
  segments: ProjectSegment[];
  activeSegmentId: string;
  onAddSegment: () => void;
  onSelectSegment: (id: string) => void;
  onDeleteSegment: (id: string) => void;
  formatTime: (seconds: number) => string;
  isLoadingVideo: boolean;
  width: number;
  onWidthChange: (width: number) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ 
  videoInfo, 
  segments,
  activeSegmentId,
  onAddSegment,
  onSelectSegment,
  onDeleteSegment,
  formatTime, 
  isLoadingVideo,
  width,
  onWidthChange
}) => {
  const [isResizing, setIsResizing] = React.useState(false);
  const sidebarRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      
      const sidebar = sidebarRef.current;
      if (!sidebar) return;
      
      const rect = sidebar.getBoundingClientRect();
      const newWidth = rect.right - e.clientX;
      
      // Constrain width between 250px and 500px
      const constrainedWidth = Math.max(250, Math.min(500, newWidth));
      onWidthChange(constrainedWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    if (isResizing) {
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      if (isResizing) { document.body.style.cursor = ''; document.body.style.userSelect = ''; }
    };
  }, [isResizing, onWidthChange]);

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  const formatFileSize = (bytes: number): string => {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <aside ref={sidebarRef} className="clip-sidebar" style={{ width }} aria-label="Clips and source information">
      <div className="sidebar-resize" onMouseDown={handleResizeStart} title="Drag to resize clip list" />
      <div className="sidebar-heading"><div><p className="eyebrow">YOUR SELECTIONS</p><h2>Clips <span className="count">{videoInfo ? segments.length : 0}</span></h2></div>
        <button className="icon-button" onClick={onAddSegment} disabled={!videoInfo || isLoadingVideo} title="Add a clip from current In/Out" aria-label="Add segment"><Plus size={18} /></button>
      </div>
      <p className="sidebar-hint">Select a clip to adjust its range.<br />Only the active clip is exported.</p>
      <div className="clip-list">
        {videoInfo ? segments.map((segment, index) => {
          const active = segment.id === activeSegmentId;
          return <div key={segment.id} className={`clip-row ${active ? 'active' : ''}`}>
            <button className="clip-select" aria-pressed={active} onClick={() => onSelectSegment(segment.id)}>
              <span className="clip-number">{String(index + 1).padStart(2, '0')}</span>
              <span className="clip-copy"><strong>{segment.name || 'Untitled clip'}</strong><span className="mono">{formatTime(segment.end - segment.start)}</span>
                <small className="mono">{formatTime(segment.start)} / {formatTime(segment.end)}</small></span>
              {active && <ChevronRight size={15} />}
            </button>
            <button className="clip-delete icon-button" title={segments.length <= 1 ? 'Keep at least one clip' : 'Delete clip'} aria-label={`Delete ${segment.name || 'clip ' + (index + 1)}`} onClick={() => onDeleteSegment(segment.id)} disabled={segments.length <= 1}><Trash2 size={13} /></button>
          </div>;
        }) : <div className="sidebar-empty">Your clips will appear here.</div>}
      </div>
      <details className="source-details">
        <summary>Source information <span>{isLoadingVideo ? 'Reading...' : videoInfo?.video?.codec?.toUpperCase() || ''}</span></summary>
        {videoInfo ? <dl>
          <dt>Resolution</dt><dd>{videoInfo.video ? `${videoInfo.video.width} x ${videoInfo.video.height}` : 'Unknown'}</dd>
          <dt>Frame rate</dt><dd>{videoInfo.video ? `${videoInfo.video.fps.toFixed(2)} fps` : 'Unknown'}</dd>
          <dt>Duration</dt><dd className="mono">{formatTime(videoInfo.duration)}</dd>
          <dt>File size</dt><dd>{formatFileSize(videoInfo.size)}</dd>
          <dt>Bitrate</dt><dd>{videoInfo.bitrate > 0 ? `${Math.round(videoInfo.bitrate / 1000)} kb/s` : 'Unknown'}</dd>
          <dt>Audio</dt><dd>{videoInfo.audio?.codec?.toUpperCase() || 'No audio'}</dd>
        </dl> : <p className="muted">Open a video to inspect its metadata.</p>}
      </details>
    </aside>
  );
};
export default Sidebar;
