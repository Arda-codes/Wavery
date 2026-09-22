/** @type {import('tailwindcss').Config} */
function withOpacity(variableName, fallback) {
  return ({ opacityValue }) => {
    if (opacityValue !== undefined) {
      return `color-mix(in srgb, var(${variableName}, ${fallback}) calc(${opacityValue} * 100%), transparent)`;
    }
    return `var(${variableName}, ${fallback})`;
  };
}

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: withOpacity("--color-bg", "#0D0D10"),
        surface: withOpacity("--color-surface", "#16161A"),
        surfaceHover: withOpacity("--color-surface-hover", "#222228"),
        surfaceActive: withOpacity("--color-surface-active", "#2A2A32"),
        deck: withOpacity("--color-deck", "#121216"),
        sidebar: withOpacity("--color-sidebar", "#0F0F12"),
        primary: withOpacity("--color-primary", "#FA586A"),
        spotify: withOpacity("--color-spotify", "#1DB954"),
        accent: withOpacity("--color-accent", "#FA586A"),
        accentHover: withOpacity("--color-accent-hover", "#E04859"),
        textPrimary: withOpacity("--color-text-primary", "#FFFFFF"),
        textSecondary: withOpacity("--color-text-secondary", "#A1A1AA"),
        textMuted: withOpacity("--color-text-muted", "#71717A"),
        danger: withOpacity("--color-danger", "#FF453A"),
        border: withOpacity("--color-border", "rgba(255, 255, 255, 0.08)"),
        borderSubtle: withOpacity("--color-border-subtle", "rgba(255, 255, 255, 0.04)"),
      }
    },
  },
  plugins: [],
}
