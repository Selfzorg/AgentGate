import { parse } from "yaml";
import type { ParsedMarkdown } from "./types";

export function parseMarkdownFrontmatter(markdown: string): ParsedMarkdown {
  if (!markdown.startsWith("---\n")) {
    return {
      frontmatter: {},
      body: markdown
    };
  }

  const endIndex = markdown.indexOf("\n---", 4);
  if (endIndex < 0) {
    return {
      frontmatter: {},
      body: markdown
    };
  }

  const rawFrontmatter = markdown.slice(4, endIndex);
  const bodyStart = markdown.indexOf("\n", endIndex + 4);
  const body = bodyStart >= 0 ? markdown.slice(bodyStart + 1) : "";

  try {
    const parsed = parse(rawFrontmatter);
    return {
      frontmatter: parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {},
      body
    };
  } catch {
    return {
      frontmatter: {
        parse_error: "Invalid YAML frontmatter."
      },
      body
    };
  }
}

export function stringFrom(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return null;
}

export function stringListFrom(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      const resolved = stringFrom(entry);
      return resolved ? [resolved] : [];
    });
  }

  const resolved = stringFrom(value);
  if (!resolved) return [];

  return resolved
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
