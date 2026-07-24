import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#090909",
        text: "#ede9e0",
        accent: "#b9a07a",
        muted: "rgba(237, 233, 224, 0.35)",
        dim: "rgba(237, 233, 224, 0.13)",
      },
      fontFamily: {
        // Map CSS Variable từ next/font vào font-serif, kèm fallback
        serif: [
          "var(--font-cormorant)",
          "Cormorant Garamond",
          "Georgia",
          "serif",
        ],
        mono: ["DM Mono", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;