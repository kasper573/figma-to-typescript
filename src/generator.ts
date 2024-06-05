import * as fs from "fs/promises";
import * as path from "path";
import { format } from "prettier";
import * as ts from "typescript";
import { figmaDataSchema } from "./parser";
import { tokenize } from "./tokenizer";
import {
  AST_designTokenFile,
  CodegenNamingConvention,
  StringTransformer,
} from "./ast";
import { createTokenGraph } from "./graph";
import { IO } from "./io";
import { createAliasResolver } from "./resolver";
import type { CLIArgs } from "./cli";
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
  };
}

export async function generate({
  inputPath,
  themeOutputPath,
  sharedOutputPath,
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
  const tokensByTheme = groupBy((token) => token.theme, tokens);
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const cnc = new CodegenNamingConvention(
    transformers?.identifier,
    transformers?.type,
  );

  const tokenEntries = Array.from(tokensByTheme.entries());
  const errorsPerFile = await Promise.all(
    tokenEntries.map(async ([theme, tokens = []]) => {
      const isShared = theme === undefined;
      const filename = isShared ? sharedOutputPath : themeOutputPath(theme);

      const pathToSharedFile = isShared
        ? "."
        : path.relative(path.dirname(filename), sharedOutputPath);

      io.log("Generating", filename);

      const sourceFile = AST_designTokenFile(
        createTokenGraph(tokens),
        resolveAlias,
        pathToSharedFile,
        sharedImportName,
        cnc,
      );

      if (!sourceFile.ok) {
        return [filename, [sourceFile.error]] as const;
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

      return [filename, errors] as const;
    }),
  );

  if (tokenEntries.length === 0) {
    io.log("No tokens found in the input data");
  }

  if (errorsPerFile.length) {
    for (const [filename, errors] of errorsPerFile) {
      if (errors.length > 0) {
        io.log(
          `Errors in ${filename}:\n${errors.map((e, n) => ` #${n + 1} ${e}`).join("\n")}`,
        );
      }
    }
  } else {
    io.log("Code generation finished without errors");
  }

  return errorsPerFile.length === 0;
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
