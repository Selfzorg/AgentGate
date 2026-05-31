import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        surface: "hsl(var(--surface))",
        muted: "hsl(var(--muted))",
        border: "hsl(var(--border))",
        accent: "hsl(var(--accent))",
        danger: "hsl(var(--danger))",
        warning: "hsl(var(--warning))",
        success: "hsl(var(--success))"
      },
      borderRadius: {
        ui: "var(--radius-ui)"
      },
      boxShadow: {
        panel: "0 1px 0 hsl(150 24% 100% / 0.05), 0 18px 60px hsl(0 0% 0% / 0.3)"
      }
    }
  },
  plugins: []
};

export default config;
