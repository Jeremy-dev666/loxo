'use client';

import { ReactNode } from 'react';

interface PixelButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  className?: string;
  type?: 'button' | 'submit' | 'reset';
  title?: string;
}

const VARIANT_STYLES = {
  primary: 'bg-pixel-yellow text-pixel-black hover:bg-pixel-orange hover:text-pixel-white',
  secondary: 'bg-pixel-white text-pixel-black hover:bg-pixel-cream',
  danger: 'bg-pixel-red text-pixel-white hover:bg-pixel-black',
};

const SIZE_STYLES = {
  sm: 'px-3 py-1 text-xs',
  md: 'px-4 py-1.5 text-sm',
  lg: 'px-6 py-2.5 text-base',
};

export function PixelButton({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  disabled = false,
  className = '',
  type = 'button',
  title,
}: PixelButtonProps) {
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`font-pixel pixel-notch-sm uppercase tracking-wide ${VARIANT_STYLES[variant]} ${SIZE_STYLES[size]} ${
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
      } ${className} relative transition-colors duration-100 active:translate-x-px active:translate-y-px`}
      style={{ filter: disabled ? 'none' : 'drop-shadow(1px 1px 0 #26221B)' }}
    >
      {children}
    </button>
  );
}
