/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        cosmos: {
          deep: '#04060f',
          night: '#0a0e1f',
          accent: '#7ad7ff',
          warm: '#ffb37a',
        },
      },
      animation: {
        'pulse-soft': 'pulse 3s ease-in-out infinite',
        'crosshair-blink': 'crosshair-blink 1.6s ease-in-out infinite',
      },
      keyframes: {
        'crosshair-blink': {
          '0%, 100%': { opacity: '0.65' },
          '50%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};
