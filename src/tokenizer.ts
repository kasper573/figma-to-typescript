import type { FigmaData, Value, Variable, Effect } from "./parser";

export interface DesignToken {
  [tokenSymbol]: true;
  theme?: string;
  name: string[];
  value: Value;
  origin: { type: "variable"; variable: Variable } | { type: "style" };
}

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
    const { name, ...values } = textStyle;
    for (const valueName of typedKeys(values)) {
      tokens.push({
        [tokenSymbol]: true,
        name: [...textStyle.name, valueName],
        value: values[valueName],
        origin: { type: "style" },
      });
    }
  }

  for (const effectStyle of data.effectStyles) {
    for (const effect of effectStyle.effects) {
      tokens.push(...createEffectTokens(effectStyle.name, effect));
    }
  }
  return tokens;
}

function createEffectTokens(
  styleName: string[],
  effect: Effect,
): DesignToken[] {
  switch (effect.type) {
    case "INNER_SHADOW":
    case "DROP_SHADOW": {
      const { color, offset, radius, spread } = effect;
      return [
        createEffectToken(styleName, { x: offset.x }),
        createEffectToken(styleName, { y: offset.y }),
        createEffectToken(styleName, { color }),
        createEffectToken(styleName, { radius }),
        createEffectToken(styleName, { spread }),
      ];
    }
  }
  return [];
}

function createEffectToken(
  prefix: string[],
  keyAndValue: { [key: string]: Value },
): DesignToken {
  const [key, value] = Object.entries(keyAndValue)[0];
  return {
    [tokenSymbol]: true,
    name: [...prefix, key],
    value,
    origin: { type: "style" },
  };
}

const typedKeys = Object.keys as <T>(o: T) => Array<keyof T>;

const tokenSymbol = Symbol("token");

export function isDesignToken(value: unknown): value is DesignToken {
  return typeof value === "object" && value !== null && tokenSymbol in value;
}
