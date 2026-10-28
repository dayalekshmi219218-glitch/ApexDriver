/** Colors come from CSS variables in src/theme.css (generated), so light/dark switch with one class. */
const c = (name) => `rgb(var(--${name}) / <alpha-value>)`;
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: c('bg'), surface: c('surface'), surface2: c('surface2'), surface3: c('surface3'),
        border: c('border'), ink: c('text'), muted: c('muted'), subtle: c('subtle'),
        primary: c('primary'), 'primary-contrast': c('primary-contrast'),
        'primary-soft': c('primary-soft'), 'on-primary-soft': c('on-primary-soft'),
        accent: c('accent'), 'accent-soft': c('accent-soft'),
        'sev-normal': c('sev-normal'), 'sev-watch': c('sev-watch'), 'sev-alert': c('sev-alert'), 'sev-none': c('sev-none'),
        'pill-normal-bg': c('pill-normal-bg'), 'pill-normal-fg': c('pill-normal-fg'),
        'pill-watch-bg': c('pill-watch-bg'), 'pill-watch-fg': c('pill-watch-fg'),
        'pill-alert-bg': c('pill-alert-bg'), 'pill-alert-fg': c('pill-alert-fg'),
        'pill-none-bg': c('pill-none-bg'), 'pill-none-fg': c('pill-none-fg'),
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'system-ui', 'sans-serif'],
        display: ['"Space Grotesk Variable"', '"Inter Variable"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgb(0 0 0 / 0.04), 0 8px 24px -12px rgb(40 30 90 / 0.18)',
        glow: '0 0 0 1px rgb(var(--primary) / 0.25), 0 12px 40px -12px rgb(var(--primary) / 0.45)',
      },
      keyframes: {
        'fade-up': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'none' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-6px)' } },
      },
      animation: { 'fade-up': 'fade-up .45s ease both', float: 'float 6s ease-in-out infinite' },
    },
  },
  plugins: [],
};
