/*
 * Neutral placeholder design tokens, converted from apps/web/src/styles/tokens.css
 * (docs/steps/human-followups.md, O5). NativeWind's style engine cannot resolve
 * oklch(), so these are the equivalent sRGB hex values for the same neutral scale.
 * Swap this file once the brand kit lands; nothing else should change.
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        background: '#ffffff',
        foreground: '#0a0a0a',
        card: '#ffffff',
        'card-foreground': '#0a0a0a',
        muted: '#f5f5f5',
        'muted-foreground': '#737373',
        border: '#e5e5e5',
        input: '#e5e5e5',
        primary: '#171717',
        'primary-foreground': '#fafafa',
        secondary: '#f5f5f5',
        'secondary-foreground': '#171717',
        accent: '#f0f0f0',
        'accent-foreground': '#171717',
        destructive: '#ef4444',
        'destructive-foreground': '#fafafa',
        ring: '#a3a3a3',
      },
    },
  },
  plugins: [],
};
