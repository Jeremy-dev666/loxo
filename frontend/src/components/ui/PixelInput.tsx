'use client';

import { forwardRef, type KeyboardEvent, type Ref } from 'react';

interface PixelInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  disabled?: boolean;
  multiline?: boolean;
  rows?: number;
  compactMultiline?: boolean;
  type?: 'text' | 'password' | 'email' | 'url' | 'date';
}

export const PixelInput = forwardRef<HTMLInputElement | HTMLTextAreaElement, PixelInputProps>(
  (
    {
      value,
      onChange,
      placeholder = '',
      className = '',
      onKeyDown,
      disabled = false,
      multiline = false,
      rows = 4,
      compactMultiline = false,
      type = 'text',
    },
    ref
  ) => {
    const baseClassName =
      'w-full bg-pixel-white border border-pixel-black font-pixel text-pixel-black px-3 py-1.5 placeholder:text-pixel-gray focus:outline-none focus:border-pixel-yellow disabled:opacity-50 disabled:cursor-not-allowed';
    const sharedStyle = { boxShadow: 'inset 1px 1px 0px 0px rgba(17,17,17,0.10)' } as const;

    if (multiline) {
      const multilineClassName = compactMultiline
        ? `${baseClassName} min-h-0 resize-none ${className}`
        : `${baseClassName} min-h-[96px] resize-y ${className}`;
      return (
        <textarea
          ref={ref as Ref<HTMLTextAreaElement>}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          onKeyDown={onKeyDown}
          disabled={disabled}
          rows={rows}
          className={multilineClassName}
          style={sharedStyle}
        />
      );
    }

    return (
      <input
        ref={ref as Ref<HTMLInputElement>}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        onKeyDown={onKeyDown}
        disabled={disabled}
        className={`${baseClassName} ${className}`}
        style={sharedStyle}
      />
    );
  }
);

PixelInput.displayName = 'PixelInput';
