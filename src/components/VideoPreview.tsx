import React, { useRef, useEffect, useState } from 'react';
import { Play, FolderOpen, Film, Loader2 } from 'lucide-react';

interface VideoPreviewProps {
  isPlaying: boolean;
  isLoading?: boolean;
  onOpen?: () => void;
  videoSrc?: string;
  currentTime: number;
  onTimeUpdate?: (time: number) => void;
  onLoadedMetadata?: (duration: number) => void;
  onPlayPause?: () => void;
}

const VideoPreview: React.FC<VideoPreviewProps> = ({ 
  isPlaying, 
  videoSrc, 
  currentTime, 
  onTimeUpdate, 
  onLoadedMetadata,
  onPlayPause,
  isLoading,
  onOpen
}) => {
  const [error, setError] = useState('');
  useEffect(() => setError(''), [videoSrc]);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Control play/pause based on isPlaying prop
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.play().catch(console.error);
    } else {
      video.pause();
    }
  }, [isPlaying]);

  // Sync video currentTime with timeline
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Only update if there's a significant difference to avoid feedback loops
    if (Math.abs(video.currentTime - currentTime) > (video.paused ? 0.001 : 0.1)) {
      video.currentTime = currentTime;
    }
  }, [currentTime]);

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (video && onTimeUpdate) {
      onTimeUpdate(video.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (video && onLoadedMetadata) {
      onLoadedMetadata(video.duration);
    }
  };

  const handleLoadError = (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
    setError('This video cannot be previewed. The source may use a codec unsupported by the player. You can still try exporting or remuxing it.');
    console.error('Video load error:', e);
    const target = e.target as HTMLVideoElement;
    console.error('Video error details:', {
      error: target.error,
      networkState: target.networkState,
      readyState: target.readyState,
      src: target.src
    });
  };
  const handleVideoClick = () => {
    if (onPlayPause) {
      onPlayPause();
    }
  };

  return (
    <div className="video-stage">
      {videoSrc ? <>
        <video ref={videoRef} src={videoSrc} className="preview-video" onTimeUpdate={handleTimeUpdate} onLoadedMetadata={handleLoadedMetadata}
          onError={handleLoadError} onClick={handleVideoClick} onEnded={() => { if (isPlaying) onPlayPause?.(); }} preload="metadata" crossOrigin="anonymous" />
        {!isPlaying && !error && <button className="preview-play" aria-label="Play video" onClick={handleVideoClick}><Play size={22} /></button>}
        {error && <div role="alert" className="preview-error">{error}</div>}
      </> : <div className="empty-stage">
        <div className="empty-film"><Film size={34} strokeWidth={1.2} /><span className="corner top-left" /><span className="corner bottom-right" /></div>
        <p className="eyebrow">LESS EDITING. MORE SHARING.</p>
        <h1>Just the part you want.</h1>
        <p>Drop a video. Find your moment.<br />Trim it down and make it fit.</p>
        <button className="primary-button" onClick={onOpen}><FolderOpen size={16} />Open video</button>
        <span className="empty-footnote">Or drop a local video anywhere in the workspace</span>
        <div className="empty-steps"><span><b>01</b> Select</span><span><b>02</b> Trim</span><span><b>03</b> Export</span></div>
      </div>}
      {isLoading && <div className="loading-overlay" role="status"><Loader2 className="animate-spin" size={22} />Reading video metadata...</div>}
    </div>
  );
};
export default VideoPreview;
