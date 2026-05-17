import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "var(--primary)",
        secondary: "var(--secondary)",
        accent: "var(--accent)",
        "bg-main": "var(--bg-main)",
        "bg-card": "var(--bg-card)",
        "bg-glass": "var(--bg-glass)",
        "text-main": "var(--text-main)",
        "text-muted": "var(--text-muted)",
        "text-inverse": "var(--text-inverse)",
        success: "var(--success)",
        warning: "var(--warning)",
        error: "var(--error)",
        info: "var(--info)",
        "glass-border": "var(--glass-border)",
      },
    },
  },
  plugins: [],
};
export default config;
