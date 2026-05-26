import { readFile } from "node:fs/promises";
import { parse } from "yaml";

export async function loadYamlFile<T>(path: string): Promise<T> {
  const raw = await readFile(path, "utf8");
  return parse(raw) as T;
}
