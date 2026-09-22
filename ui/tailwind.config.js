/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--color-bg, #0D0D10)",
        surface: "var(--color-surface, #16161A)",
        surfaceHover: "var(--color-surface-hover, #222228)",
        surfaceActive: "var(--color-surface-active, #2A2A32)",
        deck: "var(--color-deck, #121216)",
        sidebar: "var(--color-sidebar, #0F0F12)",
        primary: "var(--color-primary, #FA586A)",
        spotify: "var(--color-spotify, #1DB954)",
        accent: "var(--color-accent, #FA586A)",
        accentHover: "var(--color-accent-hover, #E04859)",
        textPrimary: "var(--color-text-primary, #FFFFFF)",
        textSecondary: "var(--color-text-secondary, #A1A1AA)",
        textMuted: "var(--color-text-muted, #71717A)",
        danger: "var(--color-danger, #FF453A)",
        border: "var(--color-border, rgba(255, 255, 255, 0.08))",
        borderSubtle: "var(--color-border-subtle, rgba(255, 255, 255, 0.04))",
      }
    },
  },
  plugins: [],
}
