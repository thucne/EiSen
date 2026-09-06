/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        dark: {
          bg: '#0f1015',
          card: 'rgba(22, 24, 34, 0.75)',
          'card-hover': 'rgba(32, 35, 50, 0.85)',
          glass: 'rgba(18, 20, 29, 0.65)',
          'glass-solid': '#151722',
        },
        accent: {
          primary: '#6366f1',
          hover: '#4f46e5',
          purple: '#a855f7',
          cyan: '#06b6d4',
        },
        border: {
          glass: 'rgba(255, 255, 255, 0.08)',
          'glass-light': 'rgba(255, 255, 255, 0.16)',
          focus: 'rgba(99, 102, 241, 0.6)',
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        glass: '0 20px 35px -10px rgba(0, 0, 0, 0.5), 0 0 1px 1px rgba(255, 255, 255, 0.08)',
        glow: '0 0 40px -10px rgba(99, 102, 241, 0.35)',
      },
    },
  },
  plugins: [],
};
