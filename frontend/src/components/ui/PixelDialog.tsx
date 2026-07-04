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
              initial={{ scale: 0.8, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.8, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="my-auto w-full max-w-lg border-4 border-pixel-black bg-pixel-white"
              style={{ boxShadow: '8px 8px 0px 0px #101010' }}
            >
              {title && (
                <div className="flex items-center justify-between border-b-4 border-pixel-black bg-pixel-green p-3 font-pixel text-xl text-pixel-white">
                  <span>{title}</span>
                  <button
                    onClick={onClose}
                    className="flex h-8 w-8 items-center justify-center border-2 border-pixel-black bg-pixel-red text-pixel-white hover:bg-pixel-orange"
                    style={{ boxShadow: '2px 2px 0px 0px #101010' }}
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
