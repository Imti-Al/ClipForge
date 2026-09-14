import React, { useState, useEffect } from 'react';
import { unwrapIpc } from '../utils/ipc';
import Dialog from './Dialog';
import { Folder, Play, Cpu, Zap, ChevronDown } from 'lucide-react';
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
  const [estimatedSize, setEstimatedSize] = useState('Variable (content-dependent)');
  const [estimateNote, setEstimateNote] = useState('');
  const [nvenc, setNvenc] = useState(false);
  const [capabilityNote, setCapabilityNote] = useState('Checking NVENC availability...');
  const [eta, setEta] = useState('');
  const [exportError, setExportError] = useState('');

  useEffect(() => {
    if (!window.electronAPI) { setCapabilityNote('NVENC checking requires the desktop app.'); return; }
    let active = true;
    window.electronAPI.getEncoderCapabilities().then(unwrapIpc).then(result => {
      if (active) { setNvenc(result.nvenc); setCapabilityNote(result.reason); }
    }).catch(error => { if (active) setCapabilityNote(String(error)); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (options.mode === 'crf') {
      setEstimatedSize('Variable (content-dependent)');
      setEstimateNote('CRF/CQ filesize cannot be accurately predicted without encoding.');
      return;
    }
    let active = true;
    if (!window.electronAPI) { setEstimatedSize('Unavailable outside the desktop app'); return; }
    setEstimatedSize('Calculating...');
    setEstimateNote('');
    const timer = setTimeout(() => {
      window.electronAPI.getExportEstimate({ inputPath: videoSrc, duration: outTime - inTime,
        targetSize: options.targetSize, copyAudio: options.copyAudio, useGPU: options.useGpu,
      }).then(unwrapIpc).then(result => {
        if (!active) return;
        setEstimatedSize(`~${(result.expectedBytes / 1000000).toFixed(2)} MB`);
        setEstimateNote(`Budget: video ${Math.round(result.videoBitrate / 1000)} kb/s + audio ${Math.round(result.audioBitrate / 1000)} kb/s, including mux allowance and safety reserve. ${options.useGpu ? 'NVENC is approximate and may undershoot substantially.' : 'CPU uses two passes; actual size can vary.'} ${options.copyAudio ? 'Copied audio uses the source average bitrate.' : ''}`);
      }).catch(error => {
        if (active) { setEstimatedSize('Unavailable'); setEstimateNote(error instanceof Error ? error.message : String(error)); }
      });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [options.mode, options.targetSize, options.copyAudio, options.useGpu, videoSrc, inTime, outTime]);

  const handleExport = async () => {
    if (!window.electronAPI) {
      console.error('Electron API not available');
      return;
    }

    setIsExporting(true);
    setProgress(0);
    setEta('');
    setExportError('');

    let removeProgressListener: (() => void) | null = null;
    try {
      if (!['mp4', 'mkv'].includes(options.format)) throw new Error('Choose MP4 or MKV for H.264 export.');
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
        if (progressData.etaSeconds !== undefined) {
          const remainingSeconds = progressData.etaSeconds;
          const minutes = Math.floor(remainingSeconds / 60);
          const seconds = Math.floor(remainingSeconds % 60);
          setEta(`${minutes}:${seconds.toString().padStart(2, '0')}`);
        } else setEta('');
      });

      const result = await window.electronAPI.exportVideo(exportOptions);
      
      if (result.success) {
        setProgress(100);
        setTimeout(() => {
          removeProgressListener?.();
          onClose();
        }, 1000);
      } else {
        console.error('Export failed');
        setExportError(result.error);
        setIsExporting(false);
        removeProgressListener?.();
      }
    } catch (error) {
      console.error('Export error:', error);
      setExportError(error instanceof Error ? error.message : String(error));
      setIsExporting(false);
      removeProgressListener?.();
    }
  };

  const handleBrowseOutputFile = async () => {
    if (!window.electronAPI) return;
    
    const suggested = ensureExt(options.filename, options.format);
    let result: string | null;
    try { result = unwrapIpc(await window.electronAPI.showSaveVideoDialog(suggested)); }
    catch (error) { setExportError(error instanceof Error ? error.message : String(error)); return; }
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
    <Dialog title="Export selection" eyebrow="MAKE IT READY TO SHARE" busy={isExporting} onClose={onClose}
      footer={<>
        <span className="footer-note"><strong>{estimatedSize}</strong><small>{isExporting ? 'Keep ClipForge open until finished.' : options.mode === 'target' ? 'Approximate final size, not a guarantee.' : 'Your source file stays untouched.'}</small></span>
        <button onClick={handleExport} disabled={isExporting || !options.outputPath || !options.filename} className="primary-button"><Play size={15} />{isExporting ? 'Exporting...' : 'Start Export'}</button>
      </>}>
      <div className="export-source"><span className="truncate" title={videoSrc}>{getBasename(videoSrc)}</span><span className="mono">{formatTime(outTime - inTime)} selected</span></div>
      {exportError && <div role="alert" className="error-box">{exportError}</div>}
      <fieldset disabled={isExporting} hidden={isExporting} className="export-settings">
        <div className="mode-choices" aria-label="Compression mode">
          <button type="button" className={options.mode === 'crf' ? 'selected' : ''} aria-pressed={options.mode === 'crf'} onClick={() => setOptions(prev => ({ ...prev, mode: 'crf' }))}><strong>Quality</strong><span>Keep the detail you need</span></button>
          <button type="button" className={options.mode === 'target' ? 'selected' : ''} aria-pressed={options.mode === 'target'} onClick={() => setOptions(prev => ({ ...prev, mode: 'target' }))}><strong>Target size</strong><span>Make it fit a file limit</span></button>
        </div>
        <div className="setting-row">
          {options.mode === 'crf' ? <>
            <div><label htmlFor="quality">Quality level <span className="subtle">{options.useGpu ? 'CQ' : 'CRF'}</span></label><p>Lower values retain more detail and use more space.</p></div>
            <input id="quality" className="number-input" type="number" min="0" max="51" value={options.crfValue} onChange={e => setOptions(prev => ({ ...prev, crfValue: parseInt(e.target.value) }))} />
          </> : <>
            <div><label htmlFor="target-size">Final file budget</label><p>Approximate total size, including audio.</p></div>
            <div className="input-unit"><input id="target-size" className="number-input" type="number" min="1" max="100000" value={options.targetSize} onChange={e => setOptions(prev => ({ ...prev, targetSize: parseInt(e.target.value) }))} /><span>MB</span></div>
          </>}
        </div>
        <div className="setting-row">
          <div><label>Encoder</label><p>{options.useGpu ? 'Fast hardware encoding. Size may vary.' : options.mode === 'target' ? 'Two-pass encoding for a closer size match.' : 'Software encoding with consistent quality.'}</p></div>
          <div className="encoder-choices">
            <button type="button" aria-pressed={!options.useGpu} className={!options.useGpu ? 'selected' : ''} onClick={() => setOptions(prev => ({ ...prev, useGpu: false }))}><Cpu size={14} />CPU</button>
            <button type="button" aria-label="Use NVENC" aria-pressed={options.useGpu} disabled={isExporting || !nvenc} title={nvenc ? 'NVIDIA hardware encoding' : capabilityNote} className={options.useGpu ? 'selected' : ''} onClick={() => setOptions(prev => ({ ...prev, useGpu: true }))}><Zap size={14} />NVENC</button>
          </div>
        </div>
        {capabilityNote && <details className="capability-note"><summary>NVENC status</summary><p>{capabilityNote}</p></details>}
        <div className="destination-section">
          <label htmlFor="export-name">File name</label>
          <div className="destination-row">
            <input id="export-name" value={options.filename} onChange={e => {
              const filename = stripExtension(e.target.value);
              setOptions(prev => ({ ...prev, filename, outputPath: prev.outputPath ? prev.outputPath.replace(/[^/\\]+$/, ensureExt(filename, prev.format)) : '' }));
            }} />
            <select aria-label="Container" value={options.format} onChange={e => { const format = e.target.value; setOptions(prev => ({ ...prev, format, outputPath: prev.outputPath ? stripExtension(prev.outputPath) + '.' + format : '' })); }}><option value="mp4">.mp4</option><option value="mkv">.mkv</option></select>
          </div>
          <label htmlFor="export-path">Destination</label>
          <div className="destination-row"><input id="export-path" value={options.outputPath} onChange={e => setOptions(prev => ({ ...prev, outputPath: e.target.value }))} placeholder="Choose where to save your clip" /><button className="secondary-button" onClick={handleBrowseOutputFile}><Folder size={15} />Browse</button></div>
        </div>
        <details className="advanced-settings">
          <summary>Advanced settings <ChevronDown size={14} /></summary>
          <div className="setting-row"><div><label htmlFor="preset">Encoding effort</label><p>Slower presets trade time for compression efficiency.</p></div>
            <select id="preset" value={options.preset} onChange={e => setOptions(prev => ({ ...prev, preset: e.target.value }))}>{['ultrafast','superfast','veryfast','faster','fast','medium','slow','slower','veryslow'].map(preset => <option key={preset} value={preset}>{preset}</option>)}</select></div>
          <label className="check-row"><input type="checkbox" checked={options.copyAudio} onChange={e => setOptions(prev => ({ ...prev, copyAudio: e.target.checked }))} /><span>Copy original audio<small>Otherwise re-encode as AAC at 128 kb/s.</small></span></label>
        </details>
      </fieldset>
      <div className="estimate-summary"><span className="eyebrow">EXPECTED FILE SIZE</span><strong>{estimatedSize}</strong><p>{estimateNote}</p></div>
      {isExporting && <div className="job-progress" role="status" aria-live="polite"><div><strong>Exporting your clip</strong><span className="mono">{Math.round(progress)}%</span></div><progress max="100" value={progress} aria-label="Export progress" /><p>{eta ? `Estimated time remaining ${eta}` : 'Preparing export...'}</p></div>}
    </Dialog>
  );
};
