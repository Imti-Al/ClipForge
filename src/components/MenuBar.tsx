import React, { useState } from 'react';
import { FolderOpen, Save, FilePen, RefreshCw, PanelRight, ChevronDown, Scissors, Check } from 'lucide-react';

interface MenuBarProps {
  onOpenRemux: () => void;
  onLoadVideo?: () => void;
  onSaveProject?: () => void;
  onSaveProjectAs?: () => void;
  onOpenProject?: () => void;
  deleteProjectOnExit?: boolean;
  onToggleDeleteProjectOnExit?: () => void;
  onExit?: () => void;
  onToggleSidebar?: () => void;
  isSidebarCollapsed?: boolean;
}

const MenuBar: React.FC<MenuBarProps> = (props) => {
  const [open, setOpen] = useState(false);
  const action = (callback?: () => void) => { setOpen(false); callback?.(); };
  return <header className="app-toolbar">
    <div className="wordmark"><span className="brand-mark"><Scissors size={17} /></span>ClipForge</div>
    <div className="file-menu" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }} onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}>
      <button className="quiet-button" aria-expanded={open} aria-controls="file-actions" onClick={() => setOpen(!open)}>File <ChevronDown size={12} /></button>
      {open && <nav id="file-actions" className="menu-popover" aria-label="File actions">
        <button onClick={() => action(props.onLoadVideo)}><FolderOpen size={15} />Open Video</button>
        <button onClick={() => action(props.onOpenProject)}><FilePen size={15} />Open Project...</button>
        <hr />
        <button onClick={() => action(props.onSaveProject)}><Save size={15} />Save Project <kbd>Ctrl S</kbd></button>
        <button onClick={() => action(props.onSaveProjectAs)}><Save size={15} />Save Project As...</button>
        <hr />
        <button onClick={() => action(props.onOpenRemux)}><RefreshCw size={15} />Remux...</button>
        <button aria-pressed={props.deleteProjectOnExit} onClick={() => action(props.onToggleDeleteProjectOnExit)}><span className="menu-check">{props.deleteProjectOnExit && <Check size={14} />}</span>Delete project on exit</button>
        <hr /><button onClick={() => action(props.onExit)}>Exit</button>
      </nav>}
    </div>
    <span className="toolbar-divider" />
    <button className="quiet-button" onClick={props.onLoadVideo}><FolderOpen size={15} />Open video</button>
    <div className="toolbar-end">
      <span className="local-indicator"><i />On your device</span>
      <button className="quiet-button" onClick={props.onOpenRemux}><RefreshCw size={14} />Remux</button>
      <button className="icon-button" aria-label={props.isSidebarCollapsed ? 'Show clips' : 'Hide clips'} aria-pressed={!props.isSidebarCollapsed} onClick={props.onToggleSidebar} title="Toggle clip list"><PanelRight size={17} /></button>
    </div>
  </header>;
};
export default MenuBar;
