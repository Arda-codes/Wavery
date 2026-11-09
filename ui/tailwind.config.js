/** @type {import('tailwindcss').Config} */
function withOpacity(variableName, fallback) {
  return ({ opacityValue }) => {
    if (opacityValue !== undefined) {
      return `color-mix(in srgb, var(${variableName}, ${fallback}) calc(${opacityValue} * 100%), transparent)`;
    }
    return `var(${variableName}, ${fallback})`;
  };
}

/**
 * Layout rhythm: 8px grid with a single 4px half-step for dense controls.
 * Padding, margin, gap and space utilities are restricted to these keys, so
 * off-grid values (p-1.5, gap-[7px], mt-3.5 …) simply do not compile.
 * Width/height/inset keep Tailwind's full scale because element sizes
 * (icons, hit targets) are not spacing.
 */
const grid = {
  0: "0px",
  px: "1px",
  1: "4px",
  2: "8px",
  3: "12px",
  4: "16px",
  5: "20px",
  6: "24px",
  8: "32px",
  10: "40px",
  12: "48px",
  14: "56px",
  16: "64px",
  20: "80px",
  24: "96px",
  28: "112px",
  32: "128px",
};

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    padding: grid,
    margin: { auto: "auto", ...grid },
    gap: grid,
    space: grid,
    /**
     * Type scale. Line heights land on the 4px grid. 11px is the floor —
     * nothing in the app renders smaller.
     */
    fontSize: {
      "2xs": ["11px", { lineHeight: "16px" }],
      xs: ["12px", { lineHeight: "16px" }],
      sm: ["14px", { lineHeight: "20px" }],
      base: ["16px", { lineHeight: "24px" }],
      lg: ["18px", { lineHeight: "24px" }],
      xl: ["20px", { lineHeight: "28px" }],
      "2xl": ["24px", { lineHeight: "32px" }],
      "3xl": ["32px", { lineHeight: "40px" }],
      "4xl": ["40px", { lineHeight: "48px" }],
      "5xl": ["48px", { lineHeight: "56px" }],
      "6xl": ["64px", { lineHeight: "64px" }],
      "7xl": ["80px", { lineHeight: "80px" }],
    },
    fontFamily: {
      /** Editorial display serif — page titles, hero titles, section headings only. */
      display: ['"Fraunces Variable"', "Georgia", "serif"],
      /** UI grotesk — every control, label and body string. */
      sans: ['"Geist Variable"', "system-ui", "-apple-system", "sans-serif"],
      /** Tabular figures — durations, counts, formats, key hints. */
      mono: ['"Geist Mono Variable"', "ui-monospace", "SFMono-Regular", "monospace"],
    },
    extend: {
      letterSpacing: {
        /** Large display titles. */
        display: "-0.025em",
        /** Small uppercase eyebrow labels. */
        caps: "0.06em",
      },
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
        onAccent: withOpacity("--color-on-accent", "#FFFFFF"),
        textPrimary: withOpacity("--color-text-primary", "#FFFFFF"),
        textSecondary: withOpacity("--color-text-secondary", "#A1A1AA"),
        textMuted: withOpacity("--color-text-muted", "#71717A"),
        danger: withOpacity("--color-danger", "#FF453A"),
        success: withOpacity("--color-success", "#30D158"),
        warning: withOpacity("--color-warning", "#FFB340"),
        border: withOpacity("--color-border", "rgba(255, 255, 255, 0.08)"),
        borderSubtle: withOpacity("--color-border-subtle", "rgba(255, 255, 255, 0.04)"),
      },
      transitionDuration: {
        240: "240ms",
        250: "250ms",
        350: "350ms",
      },
    },
  },
  plugins: [],
}
