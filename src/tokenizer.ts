import {
  type FigmaData,
  type Value,
  type Variable,
  valueSchema,
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
    if (variable.isReference) {
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

  for (const textStyle of data.textStyles) {
    const { name, ...rest } = textStyle;
    tokens.push(...flattenIntoTokenList({ type: "style" }, name, rest));
  }

  for (const effectStyle of data.effectStyles) {
    for (const effect of effectStyle.effects) {
      switch (effect.type) {
        case "INNER_SHADOW":
        case "DROP_SHADOW": {
          const { type, offset, ...rest } = effect;
          tokens.push(
            ...flattenIntoTokenList({ type: "style" }, effectStyle.name, {
              ...offset,
              ...rest,
            }),
          );
          break;
        }
      }
    }
  }
  return tokens;
}

type ValueGraph = Value | undefined | { [key: string]: ValueGraph | undefined };

function flattenIntoTokenList(
  origin: DesignTokenOrigin,
  prefix: string[],
  node: ValueGraph,
): DesignToken[] {
  if (node === undefined) {
    return [];
  }

  const result = valueSchema.safeParse(node);
  if (result.success) {
    return [
      {
        [tokenSymbol]: true,
        name: prefix,
        value: result.data,
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
