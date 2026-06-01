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
  const variablesById = new Map(
    data.variables.map((variable): [string, Variable] => [
      variable.id,
      variable,
    ]),
  );
  const themes = collectThemes(data.variables);

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

  // A text or effect style that references a theme token can't be a shared
  // token, because its resolved value differs per theme.
  // Such styles are promoted to theme tokens (emitted once per theme).
  const pushStyleTokens = (styleTokens: DesignToken[]) => {
    const referencesThemeToken = styleTokens.some(
      (token) =>
        token.value.type === "alias" &&
        variablesById.get(token.value.id)?.isShared === false,
    );

    if (!referencesThemeToken) {
      tokens.push(...styleTokens);
      return;
    }

    for (const theme of themes) {
      for (const token of styleTokens) {
        tokens.push({ ...token, theme });
      }
    }
  };

  for (const { name, props } of data.textStyles) {
    pushStyleTokens(flattenIntoTokenList({ type: "style" }, name, props));
  }

  for (const { name, effects } of data.effectStyles) {
    const styleTokens: DesignToken[] = [];
    for (const key in effects) {
      styleTokens.push(
        ...flattenIntoTokenList(
          { type: "style" },
          [...name, key],
          effects[key],
        ),
      );
    }
    pushStyleTokens(styleTokens);
  }

  return tokens;
}

function collectThemes(variables: Variable[]): string[] {
  const themes = new Set<string>();
  for (const variable of variables) {
    if (!variable.isShared) {
      for (const theme of Object.keys(variable.themeValues)) {
        themes.add(theme);
      }
    }
  }
  return [...themes];
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
