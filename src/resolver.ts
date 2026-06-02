import type { Variable, VariableAlias } from "./parser";
import { err, ok, type Result } from "./result";
import type { DesignToken } from "./tokenizer";

/**
 * How a resolved alias should be referenced from the file the source token
 * lives in:
 * - `shared`: reach into the shared tokens file (e.g. `__shared__.foo`)
 * - `theme`: reach into the theme passed to a style factory (e.g. `theme.foo`)
 * - `local`: reference a token declared in the same file
 */
export type ResolvedAlias = {
  kind: "shared" | "theme" | "local";
  path: string[];
};

export function createAliasResolver(variables: Variable[]) {
  const lookup = new Map<Variable["id"], Variable>();
  for (const variable of variables) {
    lookup.set(variable.id, variable);
  }

  return function resolve(
    source: DesignToken,
    alias: VariableAlias,
  ): Result<ResolvedAlias, string> {
    const resolved = lookup.get(alias.id);
    if (!resolved) {
      return err(`Could not find variable with id ${alias.id}`);
    }

    const isTargetShared = resolved.isShared;

    // Derived styles get their own file and pull theme values in through a
    // theme parameter, so they may reference both shared and theme tokens. A
    // theme reference is therefore never an error here.
    if (source.origin.type === "style" && source.origin.derived) {
      return ok({
        kind: isTargetShared ? "shared" : "theme",
        path: resolved.name,
      });
    }

    // Everything else lives in the shared file (shared variables and
    // non-derived styles) or a theme file (theme variables); it is shared when
    // it carries no theme.
    const isSourceShared =
      source.origin.type === "variable"
        ? source.origin.variable.isShared
        : true;
    if (isSourceShared && !isTargetShared) {
      return err(`Shared tokens may not depend on theme tokens`);
    }

    // Two tokens in the same file (both shared, or both for the same theme)
    // reference each other locally; otherwise a theme token reaches into the
    // shared file.
    return ok({
      kind: isSourceShared === isTargetShared ? "local" : "shared",
      path: resolved.name,
    });
  };
}

export type AliasResolver = ReturnType<typeof createAliasResolver>;
