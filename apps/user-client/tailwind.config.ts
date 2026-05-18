import type { Config } from 'tailwindcss';

// Tailwind v4 is zero-config; this file is a placeholder so future theme
// extensions (custom tokens, breakpoints, fonts) have a clear home.
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
};

export default config;
