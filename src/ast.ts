import * as ts from "typescript";
import { type DesignTokenGraph, type DesignTokenNode } from "./graph";
import type { Color } from "./parser";
import { type Result } from "./result";
import type { AliasResolver } from "./resolver";
import { isDesignToken } from "./tokenizer";

const F = ts.factory;

/** Name of the parameter each style factory receives the active theme through */
const THEME_PARAM_NAME = "theme";
/** Name of the type alias describing a whole theme, declared in the style file */
const THEME_TYPE_NAME = "Theme";

export function AST_designTokenFile(
  tokens: DesignTokenGraph,
  resolveAlias: AliasResolver,
  relativePathToSharedFile: string,
  sharedImportName: string,
  cnc: CodegenNamingConvention,
): Result<ts.SourceFile, string> {
  const statements: ts.Statement[] = [];

  if (relativePathToSharedFile !== ".") {
    statements.push(
      AST_importAllAs(
        toTypescriptImportPath(relativePathToSharedFile),
        sharedImportName,
        cnc,
      ),
    );
  }

  for (const [tokenName, tokenNode] of Object.entries(tokens)) {
    const tokenIdentifier = cnc.identifier(tokenName);
    statements.push(AST_typeAlias(cnc.typeName(tokenName), tokenIdentifier));

    if (isDesignToken(tokenNode)) {
      const { value } = AST_designTokenNode(
        tokenNode,
        resolveAlias,
        cnc,
        sharedImportName,
      );
      statements.push(AST_constExport(tokenIdentifier, value));
    } else {
      statements.push(
        AST_constExport(
          tokenIdentifier,
          AST_designTokenGraph(tokenNode, resolveAlias, cnc, sharedImportName),
        ),
      );
    }
  }

  return {
    ok: true,
    value: F.createSourceFile(
      statements,
      F.createToken(ts.SyntaxKind.EndOfFileToken),
      ts.NodeFlags.None,
    ),
  };
}

export interface StyleFileContext {
  sharedImportName: string;
  /** Relative path to the shared tokens file, or undefined if there is none */
  relativePathToSharedFile?: string;
  /**
   * Relative path to any one theme file, used purely to borrow its `Theme`
   * type. Undefined when there are no themes.
   */
  relativePathToThemeFile?: string;
}

/**
 * Styles are a higher order token. They live in their own file and may
 * reference both shared tokens (via the shared import) and theme tokens. Since
 * a single file can't embed a per-theme value, each top level style is emitted
 * as a factory `(theme: Theme) => (...)` and theme references resolve through
 * that parameter.
 */
export function AST_styleTokenFile(
  tokens: DesignTokenGraph,
  resolveAlias: AliasResolver,
  ctx: StyleFileContext,
  cnc: CodegenNamingConvention,
): Result<ts.SourceFile, string> {
  const statements: ts.Statement[] = [];

  if (ctx.relativePathToSharedFile !== undefined) {
    statements.push(
      AST_importAllAs(
        toRelativeImportSpecifier(ctx.relativePathToSharedFile),
        ctx.sharedImportName,
        cnc,
      ),
    );
  }

  statements.push(AST_themeTypeAlias(ctx.relativePathToThemeFile));

  for (const [tokenName, tokenNode] of Object.entries(tokens)) {
    const tokenIdentifier = cnc.identifier(tokenName);
    statements.push(
      AST_styleReturnTypeAlias(cnc.typeName(tokenName), tokenIdentifier),
    );

    const body = isDesignToken(tokenNode)
      ? AST_designTokenNode(
          tokenNode,
          resolveAlias,
          cnc,
          ctx.sharedImportName,
        ).value
      : AST_designTokenGraph(tokenNode, resolveAlias, cnc, ctx.sharedImportName);

    statements.push(AST_constExport(tokenIdentifier, AST_styleFactory(cnc, body)));
  }

  return {
    ok: true,
    value: F.createSourceFile(
      statements,
      F.createToken(ts.SyntaxKind.EndOfFileToken),
      ts.NodeFlags.None,
    ),
  };
}

function AST_designTokenNode(
  node: DesignTokenNode,
  resolveAlias: AliasResolver,
  cnc: CodegenNamingConvention,
  sharedImportName: string,
): { elementType: "property" | "getAccessor"; value: ts.Expression } {
  if (!isDesignToken(node)) {
    return {
      elementType: "property",
      value: AST_designTokenGraph(node, resolveAlias, cnc, sharedImportName),
    };
  }

  const value = node.value;

  switch (value.type) {
    case "boolean":
      return {
        elementType: "property",
        value: value.value ? F.createTrue() : F.createFalse(),
      };
    case "number":
      return {
        elementType: "property",
        value:
          value.value < 0
            ? F.createPrefixUnaryExpression(
                ts.SyntaxKind.MinusToken,
                F.createNumericLiteral(-value.value),
              )
            : F.createNumericLiteral(value.value),
      };
    case "string":
      return {
        elementType: "property",
        value: AST_asConst(F.createStringLiteral(value.value)),
      };
    case "rgb":
    case "rgba":
      return {
        elementType: "property",
        value: F.createStringLiteral(serializeColor(value)),
      };
    case "alias": {
      const result = resolveAlias(node, value);
      if (!result.ok) {
        return {
          elementType: "property",
          value: ts.addSyntheticTrailingComment(
            F.createNull(),
            ts.SyntaxKind.MultiLineCommentTrivia,
            ` Error: Skipped alias. ${result.error}`,
          ),
        };
      }

      const { kind, path } = result.value;
      switch (kind) {
        case "shared":
          return {
            elementType: "property",
            value: cnc.accessorChain([sharedImportName, ...path]),
          };
        case "theme":
          return {
            elementType: "getAccessor",
            value: cnc.accessorChain([THEME_PARAM_NAME, ...path]),
          };
        case "local":
          return {
            elementType: "getAccessor",
            value: cnc.accessorChain(path),
          };
      }
    }
  }
}

function AST_designTokenGraph(
  tokens: DesignTokenGraph,
  resolveAlias: AliasResolver,
  cnc: CodegenNamingConvention,
  sharedImportName: string,
): ts.Expression {
  return F.createObjectLiteralExpression(
    Object.entries(tokens).map(([tokenName, node]) => {
      const { elementType, value } = AST_designTokenNode(
        node,
        resolveAlias,
        cnc,
        sharedImportName,
      );
      switch (elementType) {
        case "property":
          return F.createPropertyAssignment(cnc.accessor(tokenName), value);
        case "getAccessor":
          return F.createGetAccessorDeclaration(
            undefined,
            cnc.accessor(tokenName),
            [],
            undefined,
            F.createBlock([F.createReturnStatement(value)]),
          );
      }
    }),
  );
}

function AST_importAllAs(
  importPath: string,
  variableName: string,
  cnc: CodegenNamingConvention,
): ts.Statement {
  const importClause = F.createImportClause(
    false,
    undefined,
    F.createNamespaceImport(cnc.identifier(variableName)),
  );

  return F.createImportDeclaration(
    undefined,
    importClause,
    F.createStringLiteral(importPath),
  );
}

function AST_typeAlias(
  exportId: ts.Identifier,
  identifierId: ts.Identifier,
): ts.Statement {
  return F.createTypeAliasDeclaration(
    [F.createModifier(ts.SyntaxKind.ExportKeyword)],
    exportId,
    undefined,
    F.createTypeQueryNode(identifierId),
  );
}

function AST_constExport(
  name: ts.Identifier,
  initializer: ts.Expression,
): ts.Statement {
  return F.createVariableStatement(
    [F.createModifier(ts.SyntaxKind.ExportKeyword)],
    F.createVariableDeclarationList(
      [F.createVariableDeclaration(name, undefined, undefined, initializer)],
      ts.NodeFlags.Const,
    ),
  );
}

function AST_asConst(subject: ts.Expression) {
  return F.createAsExpression(
    subject,
    F.createTypeReferenceNode(F.createIdentifier("const"), []),
  );
}

function toTypescriptImportPath(path: string) {
  return path.replace(/\\/g, "/").replace(/\.[^.]+$/, "");
}

/**
 * Like {@link toTypescriptImportPath} but guarantees a relative specifier so a
 * sibling file (e.g. `shared.ts`) isn't mistaken for a bare module import.
 */
function toRelativeImportSpecifier(path: string) {
  const specifier = toTypescriptImportPath(path);
  return specifier.startsWith(".") ? specifier : `./${specifier}`;
}

/** `export const <name> = (theme: Theme) => (<body>);` */
function AST_styleFactory(
  cnc: CodegenNamingConvention,
  body: ts.Expression,
): ts.Expression {
  const themeParameter = F.createParameterDeclaration(
    undefined,
    undefined,
    cnc.identifier(THEME_PARAM_NAME),
    undefined,
    F.createTypeReferenceNode(THEME_TYPE_NAME),
    undefined,
  );

  return F.createArrowFunction(
    undefined,
    undefined,
    [themeParameter],
    undefined,
    F.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    F.createParenthesizedExpression(body),
  );
}

/**
 * `export type Theme = typeof import("<theme file>");` — a theme's full shape,
 * borrowed from any one theme file since they are structurally identical.
 * Falls back to `unknown` when there are no themes.
 */
function AST_themeTypeAlias(relativePathToThemeFile?: string): ts.Statement {
  const themeType =
    relativePathToThemeFile !== undefined
      ? F.createImportTypeNode(
          F.createLiteralTypeNode(
            F.createStringLiteral(
              toRelativeImportSpecifier(relativePathToThemeFile),
            ),
          ),
          undefined,
          undefined,
          undefined,
          true,
        )
      : F.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword);

  return F.createTypeAliasDeclaration(
    [F.createModifier(ts.SyntaxKind.ExportKeyword)],
    F.createIdentifier(THEME_TYPE_NAME),
    undefined,
    themeType,
  );
}

/** `export type <name> = ReturnType<typeof <name>>;` */
function AST_styleReturnTypeAlias(
  exportId: ts.Identifier,
  identifierId: ts.Identifier,
): ts.Statement {
  return F.createTypeAliasDeclaration(
    [F.createModifier(ts.SyntaxKind.ExportKeyword)],
    exportId,
    undefined,
    F.createTypeReferenceNode(F.createIdentifier("ReturnType"), [
      F.createTypeQueryNode(identifierId),
    ]),
  );
}

export type StringTransformer = (name: string) => string;

export class CodegenNamingConvention {
  constructor(
    private transformIdentifier = (id: string) => id,
    private transformTypeName = (name: string) => name,
  ) {}

  accessorChain = (parts: string[]): ts.Expression => {
    parts = parts.map(this.transformIdentifier);
    let node: ts.Expression = this.assertIdentifier(parts[0]);
    for (const part of parts.slice(1)) {
      node = isValidIdentifier(part)
        ? F.createPropertyAccessExpression(node, part)
        : F.createElementAccessExpression(node, F.createStringLiteral(part));
    }
    return node;
  };

  accessor = (input: string) => {
    input = this.transformIdentifier(input);
    return isValidIdentifier(input)
      ? this.assertIdentifier(input)
      : F.createStringLiteral(input);
  };

  identifier = (input: string) => {
    return this.assertIdentifier(this.transformIdentifier(input));
  };

  typeName = (input: string) => {
    return this.assertIdentifier(this.transformTypeName(input));
  };

  private assertIdentifier = (name: string) => {
    if (!isValidIdentifier(name)) {
      throw new Error(`Invalid identifier: ${name}`);
    }
    return F.createIdentifier(name);
  };
}

function isValidIdentifier(name: string): boolean {
  return /^[a-zA-Z_]\w*$/.test(name);
}

function serializeColor(color: Color) {
  if ("a" in color && color.a !== 1) {
    return `rgba(${v(color.r)}, ${v(color.g)}, ${v(color.b)}, ${color.a.toFixed(2)})`;
  }
  return `rgb(${v(color.r)}, ${v(color.g)}, ${v(color.b)})`;
}

const v = (value: number) => Math.round(value * 255);
