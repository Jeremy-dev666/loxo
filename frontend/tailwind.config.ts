import type { Config } from 'tailwindcss';

/**
 * Monochrome base with signal accents. Color carries information only:
 * green = healthy/success, red = error/destructive, amber (yellow) = brand
 * accent and busy/pending surfaces with black text, blue resolves to a
 * darker ochre for accent text and accent fills that carry white text,
 * orange is the amber hover step. Everything else stays black/white/gray.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'pixel-black': '#111111',
        'pixel-line': '#E4E4E4',
        'pixel-white': '#FFFFFF',
        'pixel-cream': '#F5F5F5',
        'pixel-gray': '#757575',
        'pixel-red': '#C94141',
        'pixel-orange': '#C8871E',
        'pixel-brown': '#4A4A4A',
        'pixel-green': '#2F8A4C',
        'pixel-blue': '#A9721C',
        'pixel-yellow': '#F2B03D',
        // Issue-status signals, same muted register as the legacy accents:
        // steel = ready-to-work (todo), plum = under review.
        'pixel-steel': '#3E6B99',
        'pixel-plum': '#7A5B99',
      },
      fontFamily: {
        pixel: ['"Departure Mono"', 'VT323', 'monospace'],
        sans: ['var(--font-sans)', 'Inter', 'system-ui', 'sans-serif'],
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
        // Thermal printer feed: stepped, line-by-line, deliberately jerky.
        'print-feed': 'print-feed 4.5s steps(54, end) both',
        'blink-steps': 'blink-steps 0.9s steps(2, start) infinite',
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
        'print-feed': {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(0)' },
        },
        'blink-steps': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
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
