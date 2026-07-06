'use client';

import { ReactNode, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ModalPortal } from '@/components/ui/ModalPortal';

interface PixelDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

export function PixelDialog({ isOpen, onClose, title, children }: PixelDialogProps) {
  // Content mounts a beat after the frame so the scale-in animation stays smooth.
  const [showContent, setShowContent] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => setShowContent(true), 100);
      return () => clearTimeout(timer);
    }
    setShowContent(false);
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <ModalPortal>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center overflow-y-auto bg-pixel-black/70 p-4"
            onClick={onClose}
          >
            <motion.div
              initial={{ scale: 0.97, y: 8, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.97, y: 8, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="my-auto w-full max-w-lg border border-pixel-line bg-pixel-white"
              style={{ boxShadow: '3px 3px 0px 0px rgba(17,17,17,0.10)' }}
            >
              {title && (
                <div className="flex items-center justify-between border-b border-pixel-line bg-pixel-cream px-3 py-2">
                  <span className="flex items-center gap-2 font-pixel text-sm uppercase tracking-wide text-pixel-black">
                    <span className="h-3 w-1 bg-pixel-yellow" aria-hidden />
                    {title}
                  </span>
                  <button
                    onClick={onClose}
                    className="flex h-6 w-6 items-center justify-center border border-pixel-line bg-pixel-white text-xs text-pixel-black hover:bg-pixel-red hover:text-pixel-white"
                    style={{ boxShadow: '1px 1px 0px 0px rgba(17,17,17,0.10)' }}
                  >
                    X
                  </button>
                </div>
              )}
              <div className="p-4 font-pixel text-pixel-black">{showContent && children}</div>
            </motion.div>
          </motion.div>
        </ModalPortal>
      )}
    </AnimatePresence>
  );
}
