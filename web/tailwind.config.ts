import type { Config } from "tailwindcss";

const v = (name: string) => `var(--${name})`;

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: v("bg"),
        surface: v("surface-1"),
        surface2: v("surface-2"),
        line: v("border"),
        ink: v("text-primary"),
        ink2: v("text-secondary"),
        muted: v("text-muted"),
        ours: v("series-1"),
        opp: v("series-2"),
        accent: v("accent"),
      },
      fontFamily: { sans: ["var(--font-sans)", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
} satisfies Config;
