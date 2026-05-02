import React, { useState } from 'react';
import MainEditor from './components/MainEditor';
import { ExportModal } from './components/ExportModal';
import RemuxModal from './components/RemuxModal';
import './App.css';

export type ModalType = 'export' | 'remux' | null;

function App() {
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [videoSrc, setVideoSrc] = useState<string>('');
  const [inTime, setInTime] = useState(0);
  const [outTime, setOutTime] = useState(600);

  const handleCloseModal = () => {
    setActiveModal(null);
  };

  const handleOpenExport = () => {
    setActiveModal('export');
  };

  const handleOpenRemux = () => {
    setActiveModal('remux');
  };

  return (
    <div className="h-screen bg-slate-700 text-gray-200 overflow-hidden">
      <MainEditor 
        onOpenExport={handleOpenExport}
        onOpenRemux={handleOpenRemux}
        onVideoStateChange={(src, duration, inT, outT) => {
          setVideoSrc(src);
          setInTime(inT);
          setOutTime(outT);
        }}
      />
      
      {activeModal === 'export' && (
        <ExportModal 
          onClose={handleCloseModal}
          videoSrc={videoSrc}
          inTime={inTime}
          outTime={outTime}
        />
      )}
      
      {activeModal === 'remux' && (
        <RemuxModal onClose={handleCloseModal} />
      )}
    </div>
  );
}

export default App;
