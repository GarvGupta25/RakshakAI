import Parser from "tree-sitter";
import ts from "tree-sitter-typescript";

export type DiffClassification = "style_only" | "logic";

const parser = new Parser();
parser.setLanguage(ts.typescript);

/** Conservative first gate: uncertainty always becomes logic and reaches review. */
export function classifyDiff(diff: string): DiffClassification {
  const changed = diff.split("\n").filter(line => /^[+-]/.test(line) && !/^(\+\+\+|---)/.test(line));
  if (!changed.length) return "style_only";

  const content = changed.map(line => line.slice(1)).join("\n");
  if (!content.trim()) return "style_only";

  // Parse the changed snippet using Tree-Sitter
  const tree = parser.parse(content);
  
  let hasLogic = false;
  
  // Recursively check if the AST contains any non-comment nodes (ignoring errors due to snippets)
  function walk(node: Parser.SyntaxNode) {
    if (hasLogic) return;
    if (node.isNamed && node.type !== "comment" && node.type !== "ERROR" && node.type !== "program") {
      hasLogic = true;
      return;
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) walk(child);
    }
  }

  walk(tree.rootNode);

  return hasLogic ? "logic" : "style_only";
}
