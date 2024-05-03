import {
  type FigmaData,
  type Value,
  type Variable,
  ValueNode,
  isValue,
} from "./parser";

export interface DesignToken {
  [tokenSymbol]: true;
  theme?: string;
  name: string[];
  value: Value;
  origin: DesignTokenOrigin;
}

export type DesignTokenOrigin =
  | { type: "variable"; variable: Variable }
  | { type: "style" };

export function tokenize(data: FigmaData): DesignToken[] {
  const tokens: DesignToken[] = [];

  for (const variable of data.variables) {
    if (variable.isShared) {
      tokens.push({
        [tokenSymbol]: true,
        name: variable.name,
        value: variable.value,
        origin: { type: "variable", variable },
      });
    } else {
      for (const [theme, value] of Object.entries(variable.themeValues)) {
        tokens.push({
          [tokenSymbol]: true,
          theme,
          name: variable.name,
          value,
          origin: { type: "variable", variable },
        });
      }
    }
  }

  for (const { name, props } of data.textStyles) {
    tokens.push(...flattenIntoTokenList({ type: "style" }, name, props));
  }

  for (const { name, effects } of data.effectStyles) {
    for (const props of effects) {
      tokens.push(...flattenIntoTokenList({ type: "style" }, name, props));
    }
  }

  return tokens;
}

function flattenIntoTokenList(
  origin: DesignTokenOrigin,
  prefix: string[],
  node: ValueNode,
): DesignToken[] {
  if (node === undefined) {
    return [];
  }

  if (isValue(node)) {
    return [
      {
        [tokenSymbol]: true,
        name: prefix,
        value: node,
        origin,
      },
    ];
  }

  const tokens: DesignToken[] = [];
  for (const [key, value] of Object.entries(node)) {
    tokens.push(...flattenIntoTokenList(origin, [...prefix, key], value));
  }
  return tokens;
}

const tokenSymbol = Symbol("token");

export function isDesignToken(value: unknown): value is DesignToken {
  return typeof value === "object" && value !== null && tokenSymbol in value;
}
