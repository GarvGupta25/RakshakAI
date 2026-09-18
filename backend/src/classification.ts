export type DiffClassification = "style_only" | "logic";

/** Conservative first gate: uncertainty always becomes logic and reaches review. */
export function classifyDiff(diff: string): DiffClassification {
  const changed = diff.split("\n").filter(line => /^[+-]/.test(line) && !/^(\+\+\+|---)/.test(line));
  if (!changed.length) return "style_only";
  const styleOnly = changed.every(line => {
    const value = line.slice(1).trim();
    return value === "" || value.startsWith("//") || value.startsWith("#") || value.startsWith("/*") || value.startsWith("*");
  });
  return styleOnly ? "style_only" : "logic";
}
