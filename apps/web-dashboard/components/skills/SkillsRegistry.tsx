"use client";

import { useEffect, useState } from "react";
import { getSkills, type SkillRecord } from "@/lib/api-client";

const riskTone: Record<SkillRecord["default_risk_level"], string> = {
  low: "text-success",
  medium: "text-accent",
  high: "text-warning",
  critical: "text-danger"
};

export function SkillsRegistry() {
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [status, setStatus] = useState("Loading seeded skills...");

  useEffect(() => {
    void getSkills()
      .then((response) => {
        setSkills(response.skills);
        setStatus(`${response.skills.length} skills loaded from the API.`);
      })
      .catch(() => setStatus("API unavailable. Start the Phase 1 dev server."));
  }, []);

  return (
    <section className="overflow-hidden rounded-ui border border-border bg-surface shadow-panel">
      <div className="border-b border-border p-5">
        <h2 className="text-base font-semibold">Seeded Skill Registry</h2>
        <p className="mt-1 text-sm text-muted">{status}</p>
      </div>
      <div className="grid gap-0 divide-y divide-border">
        {skills.map((skill) => (
          <article key={skill.id} className="grid gap-3 p-5 md:grid-cols-[1.4fr_1fr_auto] md:items-center">
            <div>
              <h3 className="text-sm font-semibold">{skill.name}</h3>
              <p className="mt-1 font-mono text-xs text-muted">{skill.skill_id}</p>
            </div>
            <div className="text-sm text-muted">
              <div>{skill.category}</div>
              <div className="font-mono text-xs">connector {skill.connector ?? "none"}</div>
            </div>
            <div className="text-left md:text-right">
              <div className={`text-sm font-semibold ${riskTone[skill.default_risk_level]}`}>
                {skill.default_risk_level}
              </div>
              <div className="font-mono text-xs text-muted">v{skill.version}</div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
