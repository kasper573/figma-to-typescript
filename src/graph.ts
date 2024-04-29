import type { DesignToken } from "./tokenizer";

export type DesignTokenGraph = { [key: string]: DesignTokenNode };

export type DesignTokenNode = DesignToken | DesignTokenGraph;

export function createTokenGraph(tokens: DesignToken[]): DesignTokenGraph {
  const collection: DesignTokenGraph = {};
  for (const token of tokens) {
    assocPath(token.name, collection, token);
  }
  return collection;
}

function assocPath(
  path: string[],
  target: Record<string, unknown>,
  value: unknown,
): void {
  for (let i = 0; i < path.length - 1; i++) {
    const step = path[i];
    if (!(step in target)) {
      target[step] = {};
    }
    target = target[step] as typeof target;
  }
  const lastStep = path[path.length - 1];
  target[lastStep] = value;
}
