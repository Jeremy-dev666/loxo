import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'pixel-black': '#26221B',
        'pixel-white': '#FDFAF3',
        'pixel-cream': '#F5F0E6',
        'pixel-gray': '#7A7265',
        'pixel-red': '#A3402E',
        'pixel-orange': '#A8661A',
        'pixel-brown': '#5C4A33',
        'pixel-green': '#4A7A3D',
        'pixel-blue': '#4A5D7E',
        'pixel-yellow': '#C77B1E',
      },
      fontFamily: {
        pixel: ['"Departure Mono"', 'VT323', 'monospace'],
      },
      boxShadow: {
        pixel: '2px 2px 0px 0px #26221B',
        'pixel-inset': 'inset 2px 2px 0px 0px #26221B',
        'pixel-sm': '1px 1px 0px 0px #26221B',
        'pixel-lg': '3px 3px 0px 0px #26221B',
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
