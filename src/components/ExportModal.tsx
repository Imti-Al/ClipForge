import React, { useState, useEffect } from 'react';
import { unwrapIpc } from '../utils/ipc';
import Dialog from './Dialog';
import { Folder, Play, ChevronDown } from 'lucide-react';
import type { EncoderCapability, ExportOptions, ExportPlanItem, ProjectSegment, VideoCodec } from '../types/electron';

interface ExportModalProps {
  onClose: () => void;
  videoSrc: string;
  inTime: number;
  outTime: number;
  segments?: ProjectSegment[];
}

export const ExportModal: React.FC<ExportModalProps> = ({ onClose, videoSrc, inTime, outTime, segments = [] }) => {
  const [options, setOptions] = useState({
    format: 'mp4', filename: 'exported_video', outputPath: '',
    mode: 'crf' as 'crf' | 'target', crfValue: 23, preset: 'medium', targetSize: 50, copyAudio: true,
    codec: 'h264' as VideoCodec, encoderId: 'libx264', method: 'encode' as 'encode' | 'copy', scope: 'active',
  });
  const [encoders, setEncoders] = useState<EncoderCapability[]>([]);
  const [capabilityNote, setCapabilityNote] = useState('Checking encoders...');
  const [isExporting, setIsExporting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [progress, setProgress] = useState(0);
  const [eta, setEta] = useState('');
  const [jobLabel, setJobLabel] = useState('');
  const [exportError, setExportError] = useState('');
  const [status, setStatus] = useState('');
  const [plan, setPlan] = useState<ExportPlanItem[] | null>(null);
  const [planError, setPlanError] = useState('');
  const [estimatedSize, setEstimatedSize] = useState('Variable (content-dependent)');
  const [estimateNote, setEstimateNote] = useState('');
  const [completed, setCompleted] = useState<string[]>([]);
  const activeJob = React.useRef<string | null>(null);
  const running = React.useRef(false);
  const stop = React.useRef(false);
  const pending = React.useRef<ExportPlanItem[] | null>(null);
  const encoder = encoders.find(item => item.id === options.encoderId);
  const clips = options.scope === 'all' ? segments : [{ id: 'active', name: 'Active clip', start: inTime, end: outTime }];
  const clipSignature = JSON.stringify(clips);
  const formatTime = (seconds: number) => seconds.toFixed(3) + 's';
  const basename = (name: string) => name.split(/[/\\]/).pop() || name;
  const stem = (name: string) => name.replace(/\.[^./\\]+$/, '');
  const settingsKey = JSON.stringify({ ...options, videoSrc, clipSignature });

  useEffect(() => {
    let active = true;
    setEncoders([]);
    setCapabilityNote('Checking encoders on this device...');
    if (!window.electronAPI) { setCapabilityNote('Encoder checks require the desktop app.'); return; }
    window.electronAPI.getEncoderCapabilities(options.codec).then(unwrapIpc).then(result => {
      if (!active) return;
      setEncoders(result.encoders);
      setCapabilityNote(result.encoders.filter(item => item.reason).map(item => item.label + ': ' + item.reason).join('\n'));
      setOptions(previous => {
        if (running.current) return previous;
        const chosen = result.encoders.find(item => item.id === previous.encoderId && item.available)
          || result.encoders.find(item => item.available);
        if (!chosen) return previous;
        const mode = chosen.modes[previous.mode] ? previous.mode : chosen.modes.crf ? 'crf' : 'target';
        if (chosen.id === previous.encoderId) return mode === previous.mode ? previous : { ...previous, mode };
        return { ...previous, mode, encoderId: chosen.id, crfValue: chosen.quality.default, preset: chosen.defaultPreset };
      });
    }).catch(error => { if (active) setCapabilityNote(String(error)); });
    return () => { active = false; };
  }, [options.codec]);

  useEffect(() => {
    let active = true;
    pending.current = null;
    setCompleted([]); setStatus(''); setExportError(''); setPlan(null); setPlanError('');
    if (!options.outputPath || !window.electronAPI) return;
    const timer = setTimeout(() => {
      window.electronAPI.getExportPlan({ inputPath: videoSrc, outputPath: options.outputPath,
        containerFormat: options.format, clips: JSON.parse(clipSignature), method: options.method,
      }).then(unwrapIpc).then(value => { if (active) setPlan(value); })
        .catch(error => { if (active) setPlanError(String(error)); });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [settingsKey, videoSrc, options.outputPath, options.format, options.method, clipSignature]);

  useEffect(() => {
    if (options.method === 'copy') {
      setEstimatedSize('Source bitrate; no compression');
      setEstimateNote('No quality loss from re-encoding. File size follows the copied streams and adjusted duration.');
      return;
    }
    if (options.mode === 'crf') {
      setEstimatedSize('Variable (content-dependent)');
      setEstimateNote('Quality-based filesize cannot be accurately predicted without encoding.');
      return;
    }
    if (!window.electronAPI) { setEstimatedSize('Unavailable outside the desktop app'); return; }
    let active = true;
    setEstimatedSize('Calculating...');
    const timer = setTimeout(async () => {
      try {
        const selected: ProjectSegment[] = JSON.parse(clipSignature);
        const estimates = [];
        for (const clip of selected) {
          if (!active) return;
          estimates.push(unwrapIpc(await window.electronAPI.getExportEstimate({
            inputPath: videoSrc, duration: clip.end - clip.start, targetSize: options.targetSize,
            copyAudio: options.copyAudio, useGPU: !!encoder?.hardware, encoderId: options.encoderId,
          })));
        }
        if (!active) return;
        setEstimatedSize('~' + (estimates.reduce((sum, item) => sum + item.expectedBytes, 0) / 1000000).toFixed(2) + ' MB total');
        setEstimateNote('Budget includes audio, mux overhead and a safety reserve. ' +
          (encoder?.twoPass ? 'CPU x264 uses two passes.' : 'Single-pass rate control is approximate and may undershoot substantially.') +
          (selected.length > 1 ? ' The target applies to each clip separately.' : ''));
      } catch (error) { if (active) { setEstimatedSize('Unavailable'); setEstimateNote(String(error)); } }
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [options.method, options.mode, options.targetSize, options.copyAudio, options.encoderId, videoSrc, clipSignature, encoder?.hardware, encoder?.twoPass]);

  const cancelExport = async () => {
    stop.current = true;
    setCancelling(true);
    try { if (activeJob.current) unwrapIpc(await window.electronAPI.cancelMediaJob(activeJob.current)); }
    catch (error) { setExportError(String(error)); setCancelling(false); }
  };

  const handleExport = async () => {
    if (running.current || !window.electronAPI) return;
    running.current = true; stop.current = false;
    setIsExporting(true); setCancelling(false); setProgress(0); setEta(''); setExportError(''); setStatus('');
    let unsubscribe: (() => void) | undefined;
    try {
      if (options.method === 'encode' && !encoder?.modes[options.mode]) throw new Error('Choose an encoder that supports this mode.');
      if (!pending.current) {
        const prepared = unwrapIpc(await window.electronAPI.getExportPlan({ inputPath: videoSrc, outputPath: options.outputPath,
          containerFormat: options.format, clips, method: options.method }));
        // Validate every target budget before creating the first file.
        if (options.method === 'encode' && options.mode === 'target') {
          for (const clip of prepared) {
            if (stop.current) break;
            unwrapIpc(await window.electronAPI.getExportEstimate({ inputPath: videoSrc, duration: clip.duration,
              targetSize: options.targetSize, copyAudio: options.copyAudio, useGPU: !!encoder?.hardware, encoderId: options.encoderId }));
          }
        }
        if (stop.current) { setStatus('Export stopped before any files were created.'); return; }
        pending.current = prepared;
      }
      const total = pending.current.length;
      let finished = 0;
      unsubscribe = window.electronAPI.onExportProgress(data => {
        if (data.jobId !== activeJob.current) return;
        setProgress(Math.min(99, Math.floor((finished + data.progress / 100) / total * 100)));
        setEta(data.etaSeconds === undefined ? '' : Math.ceil(data.etaSeconds) + 's remaining for this clip');
      });
      while (pending.current.length && !stop.current) {
        const clip = pending.current[0];
        activeJob.current = crypto.randomUUID();
        setJobLabel(`Clip ${finished + 1} of ${total}: ${clip.name}`);
        setEta('');
        const request: ExportOptions = { jobId: activeJob.current, inputPath: videoSrc, outputPath: clip.outputPath,
          startTime: clip.startTime, duration: clip.duration, containerFormat: options.format, method: options.method,
          encoderId: options.encoderId, mode: options.mode, crfValue: options.crfValue, preset: options.preset,
          targetSize: options.targetSize, useGPU: !!encoder?.hardware, copyAudio: options.copyAudio };
        const result = await window.electronAPI.exportVideo(request);
        if (!result.success) {
          if (result.code === 'CANCELLED') { stop.current = true; break; }
          throw new Error(result.error);
        }
        pending.current.shift();
        finished++;
        setCompleted(previous => [...previous, clip.outputPath]);
      }
      if (stop.current) setStatus('Export stopped. Completed files are kept; resume to export the remaining clips.');
      else { setProgress(100); setStatus('Export complete.'); if (clips.length === 1) onClose(); }
    } catch (error) { setExportError(String(error)); }
    finally { unsubscribe?.(); activeJob.current = null; running.current = false; setIsExporting(false); setCancelling(false); }
  };

  const browse = async () => {
    try {
      const outputPath = unwrapIpc(await window.electronAPI.showSaveVideoDialog(options.filename + '.' + options.format));
      if (outputPath) setOptions(previous => ({ ...previous, outputPath, filename: stem(basename(outputPath)) }));
    } catch (error) { setExportError(String(error)); }
  };
  const chooseEncoder = (id: string) => {
    const chosen = encoders.find(item => item.id === id);
    if (chosen) setOptions(previous => ({ ...previous, encoderId: id, crfValue: chosen.quality.default, preset: chosen.defaultPreset,
      mode: chosen.modes[previous.mode] ? previous.mode : chosen.modes.crf ? 'crf' : 'target' }));
  };
  const resumable = !!pending.current?.length;
  const validEncoder = options.method === 'copy' || !!encoder?.modes[options.mode];

  return <Dialog title="Export clips" eyebrow="MAKE IT READY TO SHARE" busy={isExporting} onClose={onClose}
    footer={<>
      <span className="footer-note"><strong>{estimatedSize}</strong><small>{options.method === 'copy' ? 'Keyframe-constrained, not frame-exact.' : 'Your source file stays untouched.'}</small></span>
      {isExporting && <button onClick={cancelExport} disabled={cancelling} className="quiet-button">{cancelling ? 'Cancelling...' : 'Cancel'}</button>}
      <button onClick={handleExport} disabled={isExporting || !options.outputPath || !validEncoder || (!plan && !resumable) || !!planError || (!!pending.current && !resumable)}
        className="primary-button"><Play size={15} />{isExporting ? 'Exporting...' : resumable ? 'Resume remaining' : 'Start Export'}</button>
    </>}>
    <div className="export-source"><span className="truncate" title={videoSrc}>{basename(videoSrc)}</span><span>{clips.length} {clips.length === 1 ? 'clip' : 'clips'}</span></div>
    {exportError && <div role="alert" className="error-box">{exportError}</div>}
    {status && <p role="status">{status}</p>}
    <fieldset disabled={isExporting} hidden={isExporting} className="export-settings">
      <div className="setting-row"><label htmlFor="export-scope">Selection</label><select id="export-scope" value={options.scope} onChange={event => setOptions(previous => ({ ...previous, scope: event.target.value }))}>
        <option value="active">Active clip</option><option value="all" disabled={segments.length < 2}>All clips as separate files ({segments.length})</option></select></div>
      <div className="mode-choices" aria-label="Export method">
        <button type="button" className={options.method === 'encode' ? 'selected' : ''} aria-pressed={options.method === 'encode'} onClick={() => setOptions(previous => ({ ...previous, method: 'encode' }))}><strong>Exact</strong><span>Re-encode for precise video cuts</span></button>
        <button type="button" className={options.method === 'copy' ? 'selected' : ''} aria-pressed={options.method === 'copy'} onClick={() => setOptions(previous => ({ ...previous, method: 'copy' }))}><strong>Fast / lossless</strong><span>Copy streams at keyframe boundaries</span></button>
      </div>
      {options.method === 'encode' ? <>
        <div className="setting-row"><label htmlFor="export-codec">Video codec</label><select id="export-codec" value={options.codec} onChange={event => setOptions(previous => ({ ...previous, codec: event.target.value as VideoCodec }))}>
          <option value="h264">H.264 / most compatible</option><option value="hevc">HEVC / H.265</option><option value="av1">AV1</option></select></div>
        <div className="setting-row"><div><label htmlFor="export-encoder">Encoder</label><p>Only tested encoders are selectable. Output is 8-bit 4:2:0.</p></div>
          <select id="export-encoder" value={options.encoderId} disabled={!encoders.length} onChange={event => chooseEncoder(event.target.value)}>
            {!encoders.length && <option value={options.encoderId}>Checking device...</option>}
            {encoders.map(item => <option key={item.id} value={item.id} disabled={!item.available}>{item.label}{item.available ? '' : ' (unavailable)'}</option>)}
          </select></div>
        {capabilityNote && <details className="capability-note"><summary>Encoder availability</summary><p style={{ whiteSpace: 'pre-wrap' }}>{capabilityNote}</p></details>}
        <div className="mode-choices" aria-label="Compression mode">
          <button type="button" disabled={!encoder?.modes.crf} className={options.mode === 'crf' ? 'selected' : ''} aria-pressed={options.mode === 'crf'} onClick={() => setOptions(previous => ({ ...previous, mode: 'crf' }))}><strong>Quality</strong><span>Variable filesize</span></button>
          <button type="button" disabled={!encoder?.modes.target} className={options.mode === 'target' ? 'selected' : ''} aria-pressed={options.mode === 'target'} onClick={() => setOptions(previous => ({ ...previous, mode: 'target' }))}><strong>Target size</strong><span>Approximate budget per clip</span></button>
        </div>
        <div className="setting-row">{options.mode === 'crf' ? <>
          <div><label htmlFor="quality">Quality level / {encoder?.quality.label || 'quality'}</label><p>Lower values retain more detail. Scales differ between encoders.</p></div>
          <input id="quality" className="number-input" type="number" min={encoder?.quality.min} max={encoder?.quality.max} value={options.crfValue} onChange={event => setOptions(previous => ({ ...previous, crfValue: Number(event.target.value) }))} />
        </> : <>
          <div><label htmlFor="target-size">Final file budget per clip</label><p>Includes audio. {encoder?.twoPass ? 'Two-pass x264.' : 'Approximate single-pass rate control.'}</p></div>
          <div className="input-unit"><input id="target-size" className="number-input" type="number" min="1" max="100000" value={options.targetSize} onChange={event => setOptions(previous => ({ ...previous, targetSize: Number(event.target.value) }))} /><span>MB</span></div>
        </>}</div>
      </> : <p className="dialog-intro">Fast export expands IN backward and OUT forward to nearby keyframes. Audio packets, open GOPs and timestamps can shift the result further; use Exact for precise video cuts. Compatible audio tracks and subtitles are copied, not compressed. Chapters are omitted.</p>}
      <div className="destination-section">
        <label htmlFor="export-name">{options.scope === 'all' ? 'Batch filename prefix' : 'File name'}</label>
        <div className="destination-row"><input id="export-name" value={options.filename} onChange={event => {
          const filename = stem(event.target.value);
          setOptions(previous => ({ ...previous, filename, outputPath: previous.outputPath ? previous.outputPath.replace(/[^/\\]+$/, filename + '.' + previous.format) : '' }));
        }} /><select aria-label="Container" value={options.format} onChange={event => {
          const format = event.target.value; setOptions(previous => ({ ...previous, format, outputPath: previous.outputPath ? stem(previous.outputPath) + '.' + format : '' }));
        }}><option value="mp4">.mp4</option><option value="mkv">.mkv</option></select></div>
        <label htmlFor="export-path">Destination{options.scope === 'all' ? ' / base name for separate files' : ''}</label>
        <div className="destination-row"><input id="export-path" value={options.outputPath} onChange={event => setOptions(previous => ({ ...previous, outputPath: event.target.value }))} placeholder="Choose where to save" /><button className="secondary-button" onClick={browse}><Folder size={15} />Browse</button></div>
      </div>
      {options.method === 'encode' && <details className="advanced-settings"><summary>Advanced settings <ChevronDown size={14} /></summary>
        <div className="setting-row"><div><label htmlFor="preset">Encoder preset</label><p>{encoder?.id === 'libsvtav1' ? 'Lower numbers are slower.' : encoder?.id.includes('nvenc') ? 'P1 is fastest; P7 uses more effort.' : 'Encoder-specific speed and quality tradeoff.'}</p></div>
          <select id="preset" value={options.preset} onChange={event => setOptions(previous => ({ ...previous, preset: event.target.value }))}>{encoder?.presets.map(preset => <option key={preset} value={preset}>{preset}</option>)}</select></div>
        <label className="check-row"><input type="checkbox" checked={options.copyAudio} onChange={event => setOptions(previous => ({ ...previous, copyAudio: event.target.checked }))} /><span>Copy first audio track<small>Otherwise encode AAC at 128 kb/s. Exact export includes the first video/audio track.</small></span></label>
      </details>}
      {planError && <p role="alert" className="error-box">{planError}</p>}
      {options.outputPath && !plan && !planError && <p role="status">Checking output paths and trim boundaries...</p>}
      {plan && <details className="advanced-settings" open={options.method === 'copy'}><summary>Output files and ranges</summary>
        {plan.map(item => <p key={item.outputPath} title={item.outputPath}><strong>{basename(item.outputPath)}</strong><br />
          {formatTime(item.actualStart)} to {formatTime(item.actualEnd)}
          {item.omitted.length > 0 && <small> / Omitted: {item.omitted.join(', ')}</small>}</p>)}
      </details>}
    </fieldset>
    <div className="estimate-summary"><span className="eyebrow">EXPECTED FILE SIZE</span><strong>{estimatedSize}</strong><p>{estimateNote}</p></div>
    {isExporting && <div className="job-progress" role="status" aria-live="polite"><div><strong>{jobLabel || 'Preparing export...'}</strong><span className="mono">{progress}%</span></div><progress max="100" value={progress} aria-label="Export progress" /><p>{eta || 'Preparing clip...'}</p></div>}
    {completed.length > 0 && <details className="advanced-settings"><summary>{completed.length} completed {completed.length === 1 ? 'file' : 'files'}</summary>{completed.map(file => <p key={file} title={file}>{basename(file)}</p>)}</details>}
  </Dialog>;
};
