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
  // `derived` is true when the style references a theme token, which forces it
  // out of the shared file and into the derived file (see the tokenizer).
  | { type: "style"; derived: boolean };

export function tokenize(data: FigmaData): DesignToken[] {
  const tokens: DesignToken[] = [];
  const variablesById = new Map(
    data.variables.map((variable): [string, Variable] => [
      variable.id,
      variable,
    ]),
  );

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

  // A style that references a theme token is "derived": its resolved value
  // depends on the theme, so it is emitted to the derived file (as a factory)
  // rather than the shared file. Styles that only reference shared tokens or
  // literals keep their original home in the shared file.
  for (const { name, props } of data.textStyles) {
    const derived = referencesThemeToken(props, variablesById);
    tokens.push(
      ...flattenIntoTokenList({ type: "style", derived }, name, props),
    );
  }

  for (const { name, effects } of data.effectStyles) {
    const derived = effects.some((effect) =>
      referencesThemeToken(effect, variablesById),
    );
    for (const key in effects) {
      tokens.push(
        ...flattenIntoTokenList(
          { type: "style", derived },
          [...name, key],
          effects[key],
        ),
      );
    }
  }

  return tokens;
}

/** Whether any value reachable from `node` aliases a theme (non-shared) variable */
function referencesThemeToken(
  node: ValueNode,
  variablesById: Map<string, Variable>,
): boolean {
  if (node === undefined) {
    return false;
  }
  if (isValue(node)) {
    return (
      node.type === "alias" && variablesById.get(node.id)?.isShared === false
    );
  }
  return Object.values(node).some((child) =>
    referencesThemeToken(child, variablesById),
  );
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
