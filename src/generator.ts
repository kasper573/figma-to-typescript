import * as fs from "fs/promises";
import * as path from "path";
import { format } from "prettier";
import * as ts from "typescript";
import { figmaDataSchema } from "./parser";
import { DesignToken, tokenize } from "./tokenizer";
import {
  AST_designTokenFile,
  AST_derivedTokenFile,
  CodegenNamingConvention,
  StringTransformer,
} from "./ast";
import { createTokenGraph } from "./graph";
import { IO } from "./io";
import { createAliasResolver } from "./resolver";
import type { CLIArgs } from "./cli";
import type { Result } from "./result";
import { ZodError } from "zod";

export interface CodegenOptions
  extends Omit<CLIArgs, "themeOutputFolder" | "separator"> {
  themeOutputPath: (themeName: string) => string;
  /**
   * Parse the name of a token into its hierarchical path (usually done by splitting by a separator)
   */
  parseTokenName: (name: string) => string[];
  transformers?: {
    /**
     * Transform identifier names before generating the code
     */
    identifier?: StringTransformer;
    /**
     * Transform type names before generating the code
     */
    type?: StringTransformer;
    /**
     * Transform token values before generating the code
     */
    token?: (token: DesignToken, theme?: string) => DesignToken;
  };
}

export async function generate({
  inputPath,
  themeOutputPath,
  sharedOutputPath,
  derivedOutputPath,
  sharedImportName,
  transformers,
  parseTokenName,
  codeHeader,
}: CodegenOptions) {
  const io = new IO();
  const inputData = JSON.parse(
    await fs.readFile(path.resolve(process.cwd(), inputPath), "utf-8"),
  );

  const parseResult = figmaDataSchema(parseTokenName).safeParse(inputData);
  if (!parseResult.success) {
    io.log(
      `Failed to parse input data. Errors:\n${describeZodError(parseResult.error)}`,
    );
    return false;
  }

  const resolveAlias = createAliasResolver(parseResult.data.variables);
  const tokens = tokenize(parseResult.data);
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const cnc = new CodegenNamingConvention(
    transformers?.identifier,
    transformers?.type,
  );
  const transformToken = transformers?.token ?? ((token) => token);

  const emit = async (
    filename: string,
    sourceFile: Result<ts.SourceFile, string>,
  ): Promise<readonly [string, string[]]> => {
    if (!sourceFile.ok) {
      return [filename, [sourceFile.error]];
    }

    const errors: string[] = [];
    let code = printer.printFile(sourceFile.value);
    try {
      code = await format(code, { parser: "typescript" });
    } catch (e) {
      errors.push(`Failed to format:\n${e}`);
    }

    const saveResult = await io.save(filename, codeHeader + code);
    if (!saveResult.ok) {
      errors.push(`Failed to save:\n${saveResult.error}`);
    }

    return [filename, errors];
  };

  // Variables become shared (no theme) or theme (one per theme) tokens. A style
  // that only references shared tokens behaves like a shared token and stays in
  // the shared file; a "derived" style references a theme token and gets its
  // own file (handled separately below).
  const isDerived = (token: DesignToken) =>
    token.origin.type === "style" && token.origin.derived;
  const derivedTokens = tokens.filter(isDerived);
  const regularTokens = tokens.filter((token) => !isDerived(token));

  const regularByTheme = groupBy((token) => token.theme, regularTokens);
  const hasSharedFile = regularByTheme.has(undefined);
  const themeNames = Array.from(regularByTheme.keys()).filter(
    (theme): theme is string => theme !== undefined,
  );

  const fileTasks: Array<Promise<readonly [string, string[]]>> = [];

  for (const [theme, themeTokens = []] of regularByTheme.entries()) {
    const isShared = theme === undefined;
    const filename = isShared ? sharedOutputPath : themeOutputPath(theme);
    const pathToSharedFile = isShared
      ? "."
      : path.relative(path.dirname(filename), sharedOutputPath);

    io.log("Generating", filename);

    fileTasks.push(
      emit(
        filename,
        AST_designTokenFile(
          createTokenGraph(
            themeTokens.map((token) => transformToken(token, theme)),
          ),
          resolveAlias,
          pathToSharedFile,
          sharedImportName,
          cnc,
        ),
      ),
    );
  }

  if (derivedTokens.length > 0) {
    io.log("Generating", derivedOutputPath);

    // Derived styles borrow the `Theme` type from any one theme file (they are
    // structurally identical) so they can reference theme tokens through their
    // factory parameter.
    const canonicalTheme = themeNames[0];

    fileTasks.push(
      emit(
        derivedOutputPath,
        AST_derivedTokenFile(
          createTokenGraph(
            derivedTokens.map((token) => transformToken(token, undefined)),
          ),
          resolveAlias,
          {
            sharedImportName,
            relativePathToSharedFile: hasSharedFile
              ? path.relative(path.dirname(derivedOutputPath), sharedOutputPath)
              : undefined,
            relativePathToThemeFile:
              canonicalTheme !== undefined
                ? path.relative(
                    path.dirname(derivedOutputPath),
                    themeOutputPath(canonicalTheme),
                  )
                : undefined,
          },
          cnc,
        ),
      ),
    );
  }

  const errorsPerFile = await Promise.all(fileTasks);

  if (fileTasks.length === 0) {
    io.log("No tokens found in the input data");
  }

  for (const [filename, errors] of errorsPerFile) {
    if (errors.length > 0) {
      io.log(
        `Errors in ${filename}:\n${errors.map((e, n) => ` #${n + 1} ${e}`).join("\n")}`,
      );
    }
  }

  const hadErrors = errorsPerFile.some(([, errors]) => errors.length > 0);
  if (!hadErrors) {
    io.log("Code generation finished without errors");
  }

  return !hadErrors;
}

function describeZodError(error: ZodError): string {
  const groupedIssues = groupBy((issue) => issue.path.join("."), error.issues);
  return Array.from(groupedIssues.entries())
    .map(([path, issues]) => {
      return `  ${path}:\n${issues
        .map((issue) => `    ${issue.message}`)
        .join("\n")}`;
    })
    .join("\n");
}

function groupBy<K, V>(getGroup: (value: V) => K, values: V[]): Map<K, V[]> {
  const result = new Map<K, V[]>();
  for (const value of values) {
    const key = getGroup(value);
    let list = result.get(key);
    if (!list) {
      list = [];
      result.set(key, list);
    }
    list.push(value);
  }
  return result;
}
