import * as ts from "typescript";
import { type DesignTokenGraph, type DesignTokenNode } from "./graph";
import type { Color } from "./parser";
import { type Result } from "./result";
import type { AliasResolver } from "./resolver";
import { isDesignToken } from "./tokenizer";

const F = ts.factory;

export function AST_designTokenFile(
  tokens: DesignTokenGraph,
  resolveAlias: AliasResolver,
  relativePathToReferenceFile: string,
  cnc: CodegenNamingConvention,
): Result<ts.SourceFile, string> {
  const statements: ts.Statement[] = [];

  if (relativePathToReferenceFile !== ".") {
    statements.push(
      AST_importAllAs(
        toTypescriptImportPath(relativePathToReferenceFile),
        cnc.referenceImportName,
        cnc,
      ),
    );
  }

  for (const [tokenName, tokenNode] of Object.entries(tokens)) {
    if (!cnc.isValidIdentifier(tokenName)) {
      statements.push(
        ts.addSyntheticLeadingComment(
          F.createEmptyStatement(),
          ts.SyntaxKind.MultiLineCommentTrivia,
          ` Error: Skipped token "${tokenName}". Root level tokens names must be valid typescript identifiers.`,
        ),
      );
      continue;
    }

    const tokenNameAsId = cnc.identifier(tokenName);
    statements.push(AST_typeAlias(tokenNameAsId, tokenNameAsId));

    if (isDesignToken(tokenNode)) {
      const { value } = AST_designTokenNode(
        tokenName,
        tokenNode,
        resolveAlias,
        cnc,
      );
      statements.push(AST_asConstExport(tokenNameAsId, value));
    } else {
      statements.push(
        AST_asConstExport(
          tokenNameAsId,
          AST_designTokenGraph(tokenNode, resolveAlias, cnc),
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

function AST_designTokenNode(
  tokenName: string,
  node: DesignTokenNode,
  resolveAlias: AliasResolver,
  cnc: CodegenNamingConvention,
): { elementType: "property" | "getAccessor"; value: ts.Expression } {
  if (!isDesignToken(node)) {
    return {
      elementType: "property",
      value: AST_designTokenGraph(node, resolveAlias, cnc),
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
        value: F.createStringLiteral(value.value),
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
            ` Error: Skipped alias "${tokenName}". ${result.error}`,
          ),
        };
      }

      if (!result.value.isLocal) {
        return {
          elementType: "property",
          value: cnc.accessor([cnc.referenceImportName, ...result.value.path]),
        };
      }

      return {
        elementType: "getAccessor",
        value: cnc.accessor(result.value.path),
      };
    }
  }
}

function AST_designTokenGraph(
  tokens: DesignTokenGraph,
  resolveAlias: AliasResolver,
  cnc: CodegenNamingConvention,
): ts.Expression {
  return F.createObjectLiteralExpression(
    Object.entries(tokens).map(([tokenName, node]) => {
      const { elementType, value } = AST_designTokenNode(
        tokenName,
        node,
        resolveAlias,
        cnc,
      );
      switch (elementType) {
        case "property":
          return F.createPropertyAssignment(cnc.reference(tokenName), value);
        case "getAccessor":
          return F.createGetAccessorDeclaration(
            undefined,
            cnc.reference(tokenName),
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
    F.createTypeOperatorNode(
      ts.SyntaxKind.KeyOfKeyword,
      F.createTypeQueryNode(identifierId),
    ),
  );
}

function AST_asConstExport(
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

function toTypescriptImportPath(path: string) {
  return path.replace(/\\/g, "/").replace(/\.[^.]+$/, "");
}

export class CodegenNamingConvention {
  get referenceImportName() {
    return this.settings.referenceImportName;
  }

  constructor(
    private settings: {
      referenceImportName: string;
    },
  ) {}

  accessor(parts: string[]): ts.Expression {
    let node: ts.Expression = this.identifier(parts[0]);
    for (const part of parts.slice(1)) {
      node = this.isValidIdentifier(part)
        ? F.createPropertyAccessExpression(node, part)
        : F.createElementAccessExpression(node, this.reference(part));
    }
    return node;
  }

  reference(name: string) {
    return this.isValidIdentifier(name)
      ? this.identifier(name)
      : F.createStringLiteral(name);
  }

  identifier(name: string) {
    return F.createIdentifier(name);
  }

  isValidIdentifier(name: string): boolean {
    return /^[a-zA-Z_]\w*$/.test(name);
  }
}

function serializeColor(color: Color) {
  if ("a" in color && color.a !== 1) {
    return `rgba(${v(color.r)}, ${v(color.g)}, ${v(color.b)}, ${color.a.toFixed(2)})`;
  }
  return `rgb(${v(color.r)}, ${v(color.g)}, ${v(color.b)})`;
}

const v = (value: number) => Math.round(value * 255);
