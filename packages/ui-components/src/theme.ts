export type AgentGateTheme = {
  brandName: string;
  colors: {
    background: string;
    foreground: string;
    muted: string;
    border: string;
    accent: string;
    danger: string;
    warning: string;
    success: string;
  };
};

export const defaultAgentGateTheme: AgentGateTheme = {
  brandName: "AgentGate",
  colors: {
    background: "hsl(220 20% 98%)",
    foreground: "hsl(224 32% 12%)",
    muted: "hsl(220 10% 43%)",
    border: "hsl(220 13% 88%)",
    accent: "hsl(168 68% 34%)",
    danger: "hsl(0 68% 48%)",
    warning: "hsl(38 92% 50%)",
    success: "hsl(145 63% 37%)"
  }
};
