'use client';

import { ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface ModalPortalProps {
  children: ReactNode;
  lockScroll?: boolean;
}

/** Renders on document.body above every stacking context; optionally locks body scroll. */
export function ModalPortal({ children, lockScroll = true }: ModalPortalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    if (!mounted || !lockScroll) return;
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
    };
  }, [lockScroll, mounted]);

  if (!mounted) return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 isolate z-[2147483647]">
      <div className="pointer-events-none relative h-full w-full [&>*]:pointer-events-auto">
        {children}
      </div>
    </div>,
    document.body
  );
}
