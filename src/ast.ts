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
): Result<ts.SourceFile, string> {
  const statements: ts.Statement[] = [];

  if (relativePathToReferenceFile !== ".") {
    statements.push(
      AST_importAllAs(
        toTypescriptImportPath(relativePathToReferenceFile),
        refImportName,
      ),
    );
  }

  for (const [tokenName, tokenNode] of Object.entries(tokens)) {
    if (!isValidIdentifier(tokenName)) {
      statements.push(
        ts.addSyntheticLeadingComment(
          F.createEmptyStatement(),
          ts.SyntaxKind.MultiLineCommentTrivia,
          ` Error: Skipped token "${tokenName}". Root level tokens names must be valid typescript identifiers.`,
        ),
      );
      continue;
    }

    const tokenNameAsId = F.createIdentifier(tokenName);
    statements.push(AST_typeAlias(tokenNameAsId, tokenNameAsId));

    if (isDesignToken(tokenNode)) {
      const { value } = AST_designTokenNode(tokenName, tokenNode, resolveAlias);
      statements.push(AST_asConstExport(tokenNameAsId, value));
    } else {
      statements.push(
        AST_asConstExport(
          tokenNameAsId,
          AST_designTokenGraph(tokenNode, resolveAlias),
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
): { elementType: "property" | "getAccessor"; value: ts.Expression } {
  if (!isDesignToken(node)) {
    return {
      elementType: "property",
      value: AST_designTokenGraph(node, resolveAlias),
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
          value: ref([refImportName, ...result.value.path]),
        };
      }

      return {
        elementType: "getAccessor",
        value: ref(result.value.path),
      };
    }
  }
}

function AST_designTokenGraph(
  tokens: DesignTokenGraph,
  resolveAlias: AliasResolver,
): ts.Expression {
  return F.createObjectLiteralExpression(
    Object.entries(tokens).map(([tokenName, node]) => {
      const { elementType, value } = AST_designTokenNode(
        tokenName,
        node,
        resolveAlias,
      );
      switch (elementType) {
        case "property":
          return F.createPropertyAssignment(id(tokenName), value);
        case "getAccessor":
          return F.createGetAccessorDeclaration(
            undefined,
            id(tokenName),
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
): ts.Statement {
  const importClause = F.createImportClause(
    false,
    undefined,
    F.createNamespaceImport(F.createIdentifier(variableName)),
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

function ref(parts: string[]): ts.Expression {
  let node: ts.Expression = F.createIdentifier(parts[0]);
  for (const part of parts.slice(1)) {
    node = isValidIdentifier(part)
      ? F.createPropertyAccessExpression(node, part)
      : F.createElementAccessExpression(node, id(part));
  }
  return node;
}

function id(name: string) {
  return isValidIdentifier(name)
    ? F.createIdentifier(name)
    : F.createStringLiteral(name);
}

function isValidIdentifier(name: string): boolean {
  return /^[a-zA-Z_]\w*$/.test(name);
}

// TODO move to config that are input to the generator
const refImportName = "__ref__";

function serializeColor(color: Color) {
  if ("a" in color && color.a !== 1) {
    return `rgba(${v(color.r)}, ${v(color.g)}, ${v(color.b)}, ${color.a.toFixed(2)})`;
  }
  return `rgb(${v(color.r)}, ${v(color.g)}, ${v(color.b)})`;
}

const v = (value: number) => Math.round(value * 255);
