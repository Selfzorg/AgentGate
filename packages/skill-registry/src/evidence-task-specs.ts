export type SkillEvidenceTaskSpec = {
  check_key: string;
  label: string;
  evidence_skill_id?: string | undefined;
  instructions: string;
  success_criteria: string[];
  allowed_actions: string[];
  target_files: string[];
};

export const readOnlyEvidenceActions = new Set([
  "read_only",
  "read_file",
  "read_files",
  "rg",
  "grep",
  "git_show",
  "git_status",
  "list_files",
  "safe_shell",
  "inspect_metadata"
]);

export function normalizeEvidenceTaskSpecs(
  value: unknown,
  options: { sourceLabel?: string } = {}
): { tasks: SkillEvidenceTaskSpec[]; warnings: string[] } {
  const sourceLabel = options.sourceLabel ?? "evidence_tasks";
  if (value === undefined || value === null) return { tasks: [], warnings: [] };
  if (!Array.isArray(value)) {
    return {
      tasks: [],
      warnings: [`${sourceLabel} must be an array of structured evidence task objects.`]
    };
  }

  const warnings: string[] = [];
  const tasks: SkillEvidenceTaskSpec[] = [];
  const seen = new Set<string>();

  value.forEach((entry, index) => {
    const task = normalizeEvidenceTaskSpec(entry);
    const prefix = `${sourceLabel}[${index}]`;
    if (!task.check_key) {
      warnings.push(`${prefix} is missing check_key.`);
      return;
    }
    if (seen.has(task.check_key)) {
      warnings.push(`${prefix} duplicates check_key ${task.check_key}.`);
      return;
    }
    if (!task.label) {
      warnings.push(`${prefix} is missing label.`);
      return;
    }
    if (!task.evidence_skill_id && !task.instructions) {
      warnings.push(`${prefix} is missing instructions.`);
      return;
    }
    if (!task.evidence_skill_id && task.allowed_actions.length === 0) {
      warnings.push(`${prefix} must declare at least one read-only allowed action.`);
      return;
    }

    const disallowed = task.allowed_actions.filter((action) => !readOnlyEvidenceActions.has(action));
    if (disallowed.length > 0) {
      warnings.push(`${prefix} includes non-read-only action(s): ${disallowed.join(", ")}.`);
      return;
    }

    seen.add(task.check_key);
    tasks.push(task);
  });

  return { tasks, warnings };
}

function normalizeEvidenceTaskSpec(value: unknown): SkillEvidenceTaskSpec {
  const record = recordFrom(value);
  const rawCheckKey = stringFrom(record.check_key, record.checkKey);
  const checkKey = rawCheckKey ? normalizeCheckKey(rawCheckKey) : "";
  return {
    check_key: checkKey,
    label: stringFrom(record.label, record.name, checkKey) ?? "",
    evidence_skill_id: stringFrom(record.evidence_skill_id, record.evidenceSkillId, record.evidence_skill_ref, record.evidenceSkillRef) ?? undefined,
    instructions: stringFrom(record.instructions, record.instruction, record.description) ?? "",
    success_criteria: stringArray(record.success_criteria ?? record.successCriteria),
    allowed_actions: stringArray(record.allowed_actions ?? record.allowedActions).map(normalizeAction),
    target_files: stringArray(record.target_files ?? record.targetFiles)
  };
}

function normalizeCheckKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeAction(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (normalized === "readonly") return "read_only";
  return normalized;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      const resolved = stringFrom(entry);
      return resolved ? [resolved] : [];
    });
  }

  const resolved = stringFrom(value);
  return resolved ? [resolved] : [];
}

function stringFrom(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return null;
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
