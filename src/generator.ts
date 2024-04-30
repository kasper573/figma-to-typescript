import * as fs from "fs/promises";
import * as path from "path";
import { format } from "prettier";
import * as ts from "typescript";
import { figmaDataSchema } from "./parser";
import { tokenize } from "./tokenizer";
import { AST_designTokenFile, CodegenNamingConvention } from "./ast";
import { createTokenGraph } from "./graph";
import { IO } from "./io";
import { createAliasResolver } from "./resolver";
import type { CLIArgs } from "./cli";
import { ZodError } from "zod";

export interface CodegenOptions extends CLIArgs {
  nameTransformer?: (name: string) => string;
}

export async function generate({
  inputPath,
  themeOutputFolder,
  referenceOutputPath,
  referenceImportName,
  nameTransformer,
  separator,
  codeHeader,
}: CodegenOptions) {
  const io = new IO({
    themeOutputFolder,
    referenceOutputPath,
    nameTransformer,
  });
  const inputData = JSON.parse(
    await fs.readFile(path.resolve(process.cwd(), inputPath), "utf-8"),
  );

  const parseResult = figmaDataSchema(separator).safeParse(inputData);
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
  const cnc = new CodegenNamingConvention(nameTransformer);

  const errorsPerFile = await Promise.all(
    Array.from(tokensByTheme.entries()).map(async ([theme, tokens = []]) => {
      const filename = io.fullPathToFile(theme);
      io.log("Generating", filename);

      const sourceFile = AST_designTokenFile(
        createTokenGraph(tokens),
        resolveAlias,
        io.relativePathToReferenceFile(theme),
        referenceImportName,
        cnc,
      );

      const errors: string[] = [];
      if (sourceFile.ok) {
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
      } else {
        errors.push(sourceFile.error);
      }

      return [filename, errors] as const;
    }),
  );

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
