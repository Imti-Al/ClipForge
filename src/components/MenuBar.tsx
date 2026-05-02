import React from 'react';
import { FolderOpen, Save, FilePen as FileOpen, Trash2, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';

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

const MenuBar: React.FC<MenuBarProps> = ({ 
  onOpenRemux, 
  onLoadVideo, 
  onSaveProject,
  onSaveProjectAs,
  onOpenProject,
  deleteProjectOnExit,
  onToggleDeleteProjectOnExit,
  onExit,
  onToggleSidebar,
  isSidebarCollapsed
}) => {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      onSaveProject?.();
    }
  };

  return (
    <div 
      className="bg-slate-800 border-b border-slate-600 px-6 py-3 flex items-center justify-between"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div className="flex items-center space-x-6">
        <div className="flex items-center space-x-6 text-sm">
          <div className="relative group">
            <button className="hover:text-blue-400 transition-colors">File</button>
            {/* Simple dropdown menu */}
            <div className="absolute top-full left-0 mt-1 bg-slate-700 border border-slate-600 rounded shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-10 min-w-48">
              <button 
                onClick={onLoadVideo}
                className="flex items-center space-x-2 px-4 py-2 text-sm hover:bg-slate-600 transition-colors whitespace-nowrap"
              >
                <FolderOpen size={16} />
                <span>Open Video</span>
              </button>
              <div className="border-t border-slate-600 my-1"></div>
              <button 
                onClick={onSaveProject}
                className="flex items-center space-x-2 px-4 py-2 text-sm hover:bg-slate-600 transition-colors whitespace-nowrap w-full text-left"
              >
                <Save size={16} />
                <span>Save Project</span>
                <span className="ml-auto text-xs text-gray-400">Ctrl+S</span>
              </button>
              <button 
                onClick={onSaveProjectAs}
                className="flex items-center space-x-2 px-4 py-2 text-sm hover:bg-slate-600 transition-colors whitespace-nowrap w-full text-left"
              >
                <Save size={16} />
                <span>Save Project As...</span>
              </button>
              <button 
                onClick={onOpenProject}
                className="flex items-center space-x-2 px-4 py-2 text-sm hover:bg-slate-600 transition-colors whitespace-nowrap w-full text-left"
              >
                <FileOpen size={16} />
                <span>Open Project...</span>
              </button>
              <div className="border-t border-slate-600 my-1"></div>
              <button 
                onClick={onOpenRemux}
                className="flex items-center space-x-2 px-4 py-2 text-sm hover:bg-slate-600 transition-colors whitespace-nowrap w-full text-left"
              >
                <RefreshCw size={16} />
                <span>Remux...</span>
              </button>
              <div className="border-t border-slate-600 my-1"></div>
              <button 
                onClick={onToggleDeleteProjectOnExit}
                className="flex items-center space-x-2 px-4 py-2 text-sm hover:bg-slate-600 transition-colors whitespace-nowrap w-full text-left"
              >
                <Trash2 size={16} />
                <span>Delete project on exit</span>
                <span className="ml-auto">
                  {deleteProjectOnExit ? '✓' : ''}
                </span>
              </button>
              <div className="border-t border-slate-600 my-1"></div>
              <button 
                onClick={onExit}
                className="flex items-center space-x-2 px-4 py-2 text-sm hover:bg-slate-600 transition-colors whitespace-nowrap w-full text-left"
              >
                <span>Exit</span>
              </button>
            </div>
          </div>
          <button className="hover:text-blue-400 transition-colors">Edit</button>
          <button className="hover:text-blue-400 transition-colors">View</button>
          <button className="hover:text-blue-400 transition-colors">Help</button>
        </div>
      </div>
      
      <div className="flex items-center space-x-4">
        <button 
          onClick={onToggleSidebar}
          className="p-2 hover:bg-slate-700 rounded transition-colors"
          title={isSidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
        >
          {isSidebarCollapsed ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
        </button>
      </div>
    </div>
  );
};

export default MenuBar;