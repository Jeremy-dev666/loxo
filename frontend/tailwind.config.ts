import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'pixel-black': '#101010',
        'pixel-white': '#F8F8F8',
        'pixel-cream': '#F3EAD9',
        'pixel-gray': '#6B6B6B',
        'pixel-red': '#A83232',
        'pixel-orange': '#C4692B',
        'pixel-brown': '#5C3B24',
        'pixel-green': '#2D7D46',
        'pixel-blue': '#3A5BA0',
        'pixel-yellow': '#D4A533',
      },
      fontFamily: {
        pixel: ['VT323', 'monospace'],
      },
      boxShadow: {
        pixel: '4px 4px 0px 0px #101010',
        'pixel-inset': 'inset 4px 4px 0px 0px #101010',
        'pixel-sm': '2px 2px 0px 0px #101010',
        'pixel-lg': '6px 6px 0px 0px #101010',
      },
      animation: {
        shake: 'shake 0.3s ease-in-out infinite',
        'bounce-pixel': 'bounce-pixel 1s ease-in-out infinite',
        float: 'float 3s ease-in-out infinite',
      },
      keyframes: {
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '25%': { transform: 'translateX(-2px)' },
          '75%': { transform: 'translateX(2px)' },
        },
        'bounce-pixel': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-4px)' },
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
