import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface DialogProps {
  title: string;
  eyebrow: string;
  busy: boolean;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}

export default function Dialog({ title, eyebrow, busy, onClose, children, footer }: DialogProps) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    if (busy) panel.current?.focus();
  }, [busy]);
  const onKeyDown = (event: React.KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose(); }
    if (event.key !== 'Tab') return;
    const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]') || [])
      .filter(element => element.getClientRects().length);
    const first = controls[0], last = controls[controls.length - 1];
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus(); }
  };
  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div ref={panel} role="dialog" aria-modal="true" aria-label={title} aria-busy={busy} tabIndex={-1} className="dialog-panel" onKeyDown={onKeyDown}>
      <header className="dialog-header"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div>
        <button className="icon-button" onClick={onClose} disabled={busy} aria-label="Close dialog"><X size={18} /></button>
      </header>
      <div className="dialog-body">{children}</div>
      <footer className="dialog-footer">{footer}</footer>
    </div>
  </div>;
}
