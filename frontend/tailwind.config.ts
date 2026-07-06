import type { Config } from 'tailwindcss';

/**
 * Monochrome palette. Legacy pixel-* hue names are kept as class names but
 * resolve to a gray ramp chosen so existing bg/text pairings stay readable:
 * dark tokens (black/blue/green/red) carry white text, light tokens
 * (cream/yellow) carry black text.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'pixel-black': '#111111',
        'pixel-white': '#FFFFFF',
        'pixel-cream': '#F5F5F5',
        'pixel-gray': '#757575',
        'pixel-red': '#111111',
        'pixel-orange': '#3D3D3D',
        'pixel-brown': '#4A4A4A',
        'pixel-green': '#3D3D3D',
        'pixel-blue': '#111111',
        'pixel-yellow': '#9B9B9B',
      },
      fontFamily: {
        pixel: ['"Departure Mono"', 'VT323', 'monospace'],
      },
      boxShadow: {
        pixel: '0 1px 3px rgba(17,17,17,0.10)',
        'pixel-inset': 'inset 0 1px 2px rgba(17,17,17,0.08)',
        'pixel-sm': '0 1px 2px rgba(17,17,17,0.08)',
        'pixel-lg': '0 2px 6px rgba(17,17,17,0.12)',
      },
      animation: {
        shake: 'shake 0.3s ease-in-out infinite',
        'bounce-pixel': 'bounce-pixel 1s ease-in-out infinite',
        float: 'float 3s ease-in-out infinite',
      },
      keyframes: {
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '25%': { transform: 'translateX(-1px)' },
          '75%': { transform: 'translateX(1px)' },
        },
        'bounce-pixel': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-4px)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-2px)' },
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
    function ({ addUtilities }: { addUtilities: (utilities: Record<string, Record<string, string>>) => void }) {
      addUtilities({ '.pixelated': { imageRendering: 'pixelated' } });
    },
  ],
};

export default config;
