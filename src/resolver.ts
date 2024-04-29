import type { Variable, VariableAlias } from "./parser";
import { err, ok, type Result } from "./result";
import type { DesignToken } from "./tokenizer";

export function createAliasResolver(variables: Variable[]) {
  const lookup = new Map<Variable["id"], Variable>();
  for (const variable of variables) {
    lookup.set(variable.id, variable);
  }

  return function resolve(
    source: DesignToken,
    alias: VariableAlias,
  ): Result<{ isLocal: boolean; path: string[] }, string> {
    const resolved = lookup.get(alias.id);
    if (!resolved) {
      return {
        ok: false,
        error: `Could not find variable with id ${alias.id}`,
      };
    }

    const isTargetRef = resolved.isReference;
    const isSourceRef =
      source.origin.type === "style"
        ? true
        : source.origin.variable.isReference;

    if (isSourceRef && !isTargetRef) {
      return err(`Reference tokens may not depend on theme tokens`);
    }

    return ok({
      isLocal: isSourceRef === isTargetRef,
      path: resolved.name,
    });
  };
}

export type AliasResolver = ReturnType<typeof createAliasResolver>;
