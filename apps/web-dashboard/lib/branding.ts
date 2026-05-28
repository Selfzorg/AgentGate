import { defaultAgentGateTheme } from "@agentgate/ui-components";

export const branding = {
  productName: defaultAgentGateTheme.brandName,
  shortName: "AG",
  tagline: "Runtime control plane for AI agent skills"
};

export const navigationItems = [
  { href: "/", label: "Overview" },
  { href: "/system-guide", label: "System Guide" },
  { href: "/live", label: "Live" },
  { href: "/approvals", label: "Approvals" },
  { href: "/evidence", label: "Evidence" },
  { href: "/skill-runs", label: "Skill Runs" },
  { href: "/audit", label: "Audit" },
  { href: "/skills", label: "Skills" },
  { href: "/policies", label: "Policies" },
  { href: "/risk-scanner", label: "Risk Scanner" },
  { href: "/settings", label: "Settings" }
] as const;
