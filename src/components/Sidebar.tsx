import React from 'react';
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
    <div 
      ref={sidebarRef}
      className="bg-slate-800 border-l border-slate-600 flex flex-col relative"
      style={{ width: `${width}px` }}
    >
      {/* Resize handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 hover:bg-opacity-50 transition-colors z-10"
        onMouseDown={handleResizeStart}
        title="Drag to resize sidebar"
      />
      
      {/* Video Info */}
      <div className="p-4 border-b border-slate-600">
        <h4 className="text-md font-semibold mb-3 text-gray-200">Video Info</h4>
        
        {isLoadingVideo ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400"></div>
          </div>
        ) : videoInfo ? (
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-gray-400">Codec</span>
              <span className="text-gray-200">
                {videoInfo?.video?.codec && videoInfo.video.codec !== 'unknown'
                  ? videoInfo.video.codec.toUpperCase()
                  : 'Unknown'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Resolution</span>
              <span className="text-gray-200">
                {videoInfo.video ? `${videoInfo.video.width} x ${videoInfo.video.height}` : 'Unknown'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">FPS</span>
              <span className="text-gray-200">
                {videoInfo.video ? Math.round(videoInfo.video.fps) : 'Unknown'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Duration</span>
              <span className="text-gray-200">{formatTime(videoInfo.duration)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">File Size</span>
              <span className="text-gray-200">{formatFileSize(videoInfo.size)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Bitrate</span>
              <span className="text-gray-200">
                {Number.isFinite(videoInfo?.bitrate) && videoInfo.bitrate > 0
                  ? `${Math.round(videoInfo.bitrate / 1000)} kbps`
                  : 'Unknown'}
              </span>
            </div>
          </div>
        ) : (
          <div className="text-center py-8 text-gray-400">
            <p>No video loaded</p>
            <p className="text-sm mt-2">Open a video file to see information</p>
          </div>
        )}
      </div>
      
      {/* Segments */}
      <div className="flex-1 p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-md font-semibold text-gray-200">Segments</h4>
          <button
            onClick={onAddSegment}
            className="text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-gray-200 transition-colors"
            title="Add a segment from current In/Out"
          >
            Add
          </button>
        </div>
        
        <div className="space-y-2">
          {segments.map((segment) => {
            const isActive = segment.id === activeSegmentId;
            return (
            <div 
              key={segment.id}
              className={[
                'rounded px-3 py-2 text-sm border transition-colors',
                isActive
                  ? 'bg-blue-500/20 border-blue-500/40'
                  : 'bg-emerald-500/20 border-emerald-500/30 hover:bg-emerald-500/25 cursor-pointer',
              ].join(' ')}
              onClick={() => onSelectSegment(segment.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-gray-200 truncate" title={segment.name || segment.id}>
                    {segment.name || 'Segment'}
                    {isActive ? ' (active)' : ''}
                  </div>
                  <div className="text-gray-300">
                    {formatTime(segment.start)} - {formatTime(segment.end)}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteSegment(segment.id);
                  }}
                  className="text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-gray-200 transition-colors"
                  title="Delete segment"
                  disabled={segments.length <= 1}
                >
                  Delete
                </button>
              </div>
              <div className={`text-xs mt-1 ${isActive ? 'text-blue-300' : 'text-emerald-400'}`}>
                Duration: {formatTime(segment.end - segment.start)}
              </div>
            </div>
          )})}
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
