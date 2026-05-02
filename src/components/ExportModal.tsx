import React, { useState, useEffect } from 'react';
import { X, Folder, Play } from 'lucide-react';
import type { ExportOptions, ExportProgress } from '../types/electron';

interface ExportModalProps {
  onClose: () => void;
  videoSrc: string;
  inTime: number;
  outTime: number;
}

interface ExportFormState {
  format: string;
  filename: string;
  outputPath: string;
  mode: 'crf' | 'target';
  crfValue: number;
  preset: string;
  targetSize: number;
  useGpu: boolean;
  copyAudio: boolean;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  onClose,
  videoSrc,
  inTime,
  outTime
}) => {
  const stripExtension = (name: string) => name.replace(/\.[^./\\]+$/u, '');
  const getExtension = (p: string) => {
    const m = String(p).match(/\.([a-z0-9]+)$/i);
    return m?.[1]?.toLowerCase() || '';
  };
  const getBasename = (p: string) => String(p).split(/[/\\]/).pop() || '';
  const ensureExt = (name: string, ext: string) => {
    const cleanName = stripExtension(String(name || 'exported_video'));
    const cleanExt = String(ext || 'mp4').replace(/^\./, '').toLowerCase();
    return `${cleanName}.${cleanExt}`;
  };

  const [options, setOptions] = useState<ExportFormState>({
    format: 'mp4',
    filename: 'exported_video',
    outputPath: '',
    mode: 'crf',
    crfValue: 23,
    preset: 'medium',
    targetSize: 50,
    useGpu: false,
    copyAudio: true
  });

  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [estimatedSize, setEstimatedSize] = useState('~45 MB');
  const [eta, setEta] = useState('');

  useEffect(() => {
    // Calculate estimated output size based on settings
    const duration = Math.max(0, outTime - inTime);
    if (duration <= 0) {
      setEstimatedSize('—');
      return;
    }
    const bitrate = options.mode === 'crf' 
      ? Math.max(1000, 8000 - (options.crfValue - 18) * 200)
      : (options.targetSize * 8 * 1024) / duration;
    
    const estimatedMB = Math.round((bitrate * duration) / (8 * 1024));
    setEstimatedSize(`~${estimatedMB} MB`);
  }, [options, inTime, outTime]);

  const handleExport = async () => {
    if (!window.electronAPI) {
      console.error('Electron API not available');
      return;
    }

    setIsExporting(true);
    setProgress(0);
    setEta('');

    let removeProgressListener: (() => void) | null = null;
    try {
      const segmentDuration = Math.max(0, outTime - inTime);
      if (segmentDuration <= 0) {
        console.error('Invalid segment duration');
        setIsExporting(false);
        return;
      }
      if (!options.outputPath) {
        console.error('Missing output path');
        setIsExporting(false);
        return;
      }
      const exportOptions: ExportOptions = {
        inputPath: videoSrc,
        outputPath: options.outputPath,
        startTime: inTime,
        duration: segmentDuration,
        containerFormat: options.format,
        mode: options.mode,
        crfValue: options.crfValue,
        preset: options.preset,
        targetSize: options.targetSize,
        useGPU: options.useGpu,
        copyAudio: options.copyAudio
      };

      // Listen for progress updates
      removeProgressListener = window.electronAPI.onExportProgress((progressData: ExportProgress) => {
        setProgress(progressData.progress);
        if (progressData.speed > 0) {
          const remainingSeconds = Math.max(0, segmentDuration - progressData.currentTime) / progressData.speed;
          const minutes = Math.floor(remainingSeconds / 60);
          const seconds = Math.floor(remainingSeconds % 60);
          setEta(`${minutes}:${seconds.toString().padStart(2, '0')}`);
        }
      });

      const result = await window.electronAPI.exportVideo(exportOptions);
      
      if (result.success) {
        setProgress(100);
        setTimeout(() => {
          removeProgressListener?.();
          onClose();
        }, 1000);
      } else {
        console.error('Export failed:', result.error);
        setIsExporting(false);
        removeProgressListener?.();
      }
    } catch (error) {
      console.error('Export error:', error);
      setIsExporting(false);
      removeProgressListener?.();
    }
  };

  const handleBrowseOutputFile = async () => {
    if (!window.electronAPI) return;
    
    const suggested = ensureExt(options.filename, options.format);
    const result = await window.electronAPI.showSaveVideoDialog(suggested);
    if (result) {
      const pickedExt = getExtension(result);
      const pickedBase = stripExtension(getBasename(result));
      setOptions(prev => ({
        ...prev,
        outputPath: result,
        // keep UI consistent with picked file
        filename: pickedBase || prev.filename,
        format: pickedExt || prev.format,
      }));
    }
  };

  const formatTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-slate-800/95 backdrop-blur-md rounded-xl border border-slate-700/50 w-full max-w-2xl mx-4 shadow-2xl">
        <div className="flex items-center justify-between p-6 border-b border-slate-700/50">
          <h2 className="text-xl font-semibold text-white">Export Video</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-700/50 rounded-lg transition-colors"
            disabled={isExporting}
          >
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Output Format */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Output Container Format
            </label>
            <select
              value={options.format}
              onChange={(e) => {
                const nextFormat = e.target.value;
                setOptions(prev => {
                  const next = { ...prev, format: nextFormat };
                  // If the user already chose an output file, keep its extension aligned.
                  if (next.outputPath) {
                    const base = stripExtension(next.outputPath);
                    next.outputPath = `${base}.${String(nextFormat).toLowerCase()}`;
                  }
                  return next;
                });
              }}
              className="w-full bg-slate-700/50 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isExporting}
            >
              <option value="mp4">MP4</option>
              <option value="mkv">MKV</option>
              <option value="webm">WebM</option>
              <option value="avi">AVI</option>
            </select>
          </div>

          {/* Filename */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Filename
            </label>
            <input
              type="text"
              value={options.filename}
              onChange={(e) => {
                const raw = e.target.value;
                const cleaned = stripExtension(raw);
                setOptions(prev => {
                  const next = { ...prev, filename: cleaned };
                  // If an outputPath is already chosen, keep its basename aligned to the filename.
                  if (next.outputPath) {
                    const dir = next.outputPath.replace(/[\\/][^\\/]*$/u, '');
                    const sep = dir && !dir.endsWith('/') && !dir.endsWith('\\') ? (next.outputPath.includes('\\') ? '\\' : '/') : '';
                    next.outputPath = `${dir}${sep}${ensureExt(cleaned, next.format)}`;
                  }
                  return next;
                });
              }}
              className="w-full bg-slate-700/50 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isExporting}
            />
          </div>

          {/* Destination */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Save As
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={options.outputPath}
                onChange={(e) => setOptions(prev => ({ ...prev, outputPath: e.target.value }))}
                className="flex-1 bg-slate-700/50 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Choose an output file..."
                disabled={isExporting}
              />
              <button
                onClick={handleBrowseOutputFile}
                className="px-4 py-2 bg-slate-600 hover:bg-slate-500 rounded-lg transition-colors flex items-center gap-2"
                disabled={isExporting}
              >
                <Folder className="w-4 h-4" />
                Browse
              </button>
            </div>
          </div>

          {/* Mode Switcher */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Compression Mode
            </label>
            <div className="flex bg-slate-700/50 rounded-lg p-1">
              <button
                onClick={() => setOptions(prev => ({ ...prev, mode: 'crf' }))}
                className={`flex-1 py-2 px-4 rounded-md transition-colors ${
                  options.mode === 'crf'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
                disabled={isExporting}
              >
                CRF (Quality)
              </button>
              <button
                onClick={() => setOptions(prev => ({ ...prev, mode: 'target' }))}
                className={`flex-1 py-2 px-4 rounded-md transition-colors ${
                  options.mode === 'target'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
                disabled={isExporting}
              >
                Target Size
              </button>
            </div>
          </div>

          {/* Mode-specific options */}
          {options.mode === 'crf' ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  CRF Value
                </label>
                <input
                  type="number"
                  min="0"
                  max="51"
                  value={options.crfValue}
                  onChange={(e) => setOptions(prev => ({ ...prev, crfValue: parseInt(e.target.value) }))}
                  className="w-full bg-slate-700/50 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={isExporting}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Preset
                </label>
                <select
                  value={options.preset}
                  onChange={(e) => setOptions(prev => ({ ...prev, preset: e.target.value }))}
                  className="w-full bg-slate-700/50 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={isExporting}
                >
                  <option value="ultrafast">Ultra Fast</option>
                  <option value="superfast">Super Fast</option>
                  <option value="veryfast">Very Fast</option>
                  <option value="faster">Faster</option>
                  <option value="fast">Fast</option>
                  <option value="medium">Medium</option>
                  <option value="slow">Slow</option>
                  <option value="slower">Slower</option>
                  <option value="veryslow">Very Slow</option>
                </select>
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Target Size (MB)
              </label>
              <input
                type="number"
                min="1"
                value={options.targetSize}
                onChange={(e) => setOptions(prev => ({ ...prev, targetSize: parseInt(e.target.value) }))}
                className="w-full bg-slate-700/50 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isExporting}
              />
            </div>
          )}

          {/* GPU Encoding Toggle */}
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-slate-300">
              Use GPU Encoding (NVENC)
            </label>
            <button
              onClick={() => setOptions(prev => ({ ...prev, useGpu: !prev.useGpu }))}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                options.useGpu ? 'bg-emerald-600' : 'bg-slate-600'
              }`}
              disabled={isExporting}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  options.useGpu ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Copy Audio Toggle */}
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-slate-300">
              Copy Audio Stream
            </label>
            <button
              onClick={() => setOptions(prev => ({ ...prev, copyAudio: !prev.copyAudio }))}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                options.copyAudio ? 'bg-emerald-600' : 'bg-slate-600'
              }`}
              disabled={isExporting}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  options.copyAudio ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Estimated Output Size */}
          <div className="bg-slate-700/30 rounded-lg p-4">
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-400">Estimated Output Size:</span>
              <span className="text-white font-medium">{estimatedSize}</span>
            </div>
            <div className="flex justify-between items-center text-sm mt-1">
              <span className="text-slate-400">Segment Duration:</span>
              <span className="text-white font-medium">{formatTime(outTime - inTime)}</span>
            </div>
          </div>

          {/* Progress Bar (shown during export) */}
          {isExporting && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Exporting...</span>
                <span className="text-white">{Math.round(progress)}%</span>
              </div>
              <div className="w-full bg-slate-700 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              {eta && (
                <div className="text-center text-sm text-slate-400">
                  ETA: {eta}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Export Button */}
        <div className="flex justify-end p-6 border-t border-slate-700/50">
          <button
            onClick={handleExport}
            disabled={isExporting || !options.outputPath || !options.filename}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed rounded-lg font-medium text-white transition-colors flex items-center gap-2"
          >
            <Play className="w-4 h-4" />
            {isExporting ? 'Exporting...' : 'Start Export'}
          </button>
        </div>
      </div>
    </div>
  );
};
