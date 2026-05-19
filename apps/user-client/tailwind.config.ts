// SPDX-License-Identifier: AGPL-3.0-only
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    screens: { lg: '1024px' },
  },
};

export default config;
