import React, { useRef, useEffect } from 'react';
import { Play, Pause } from 'lucide-react';

interface VideoPreviewProps {
  isPlaying: boolean;
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
  onPlayPause
}) => {
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
    if (Math.abs(video.currentTime - currentTime) > 0.1) {
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
    <div className="h-full bg-slate-800 rounded-lg overflow-hidden relative">
      {videoSrc ? (
        <>
          {/* HTML5 Video Element */}
          <video
            ref={videoRef}
            src={videoSrc}
            className="w-full h-full object-contain bg-black"
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onError={handleLoadError}
            onClick={handleVideoClick}
            preload="metadata"
            crossOrigin="anonymous"
          />
          
          {/* Play/Pause overlay - only show when paused */}
          {!isPlaying && (
            <div className="absolute inset-0 flex items-center justify-center cursor-pointer" onClick={handleVideoClick}>
              <div className="bg-white bg-opacity-20 backdrop-blur-sm rounded-full p-6">
                <Play size={48} className="text-white ml-2" />
              </div>
            </div>
          )}
        </>
      ) : (
        /* Fallback when no video is loaded */
        <div className="h-full w-full bg-slate-900 relative flex items-center justify-center">
          {/* Centered empty state message */}
          <div className="text-center space-y-4">
            <div className="bg-slate-700 bg-opacity-50 backdrop-blur-sm rounded-full p-8 mx-auto w-fit">
              {isPlaying ? (
                <Pause size={64} className="text-slate-400" />
              ) : (
                <Play size={64} className="text-slate-400 ml-2" />
              )}
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-semibold text-slate-300">No video loaded</h3>
              <p className="text-slate-400 text-sm">Drop video file(s) here to begin editing</p>
              <p className="text-slate-500 text-xs">or use File → Open Video</p>
            </div>
          </div>
        </div>
      )}
      
      {/* Video info overlay - show when video is loaded */}
      {videoSrc && (
        <div className="absolute bottom-4 left-4 bg-black bg-opacity-50 backdrop-blur-sm rounded px-3 py-1 text-sm">
          {/* This will be populated with actual video info from ffprobe */}
          <span className="text-gray-300">Video loaded</span>
        </div>
      )}
    </div>
  );
};

export default VideoPreview;