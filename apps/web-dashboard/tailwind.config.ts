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
        panel: "0 1px 2px hsl(220 30% 12% / 0.06), 0 12px 32px hsl(220 30% 12% / 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
