import * as path from "path";
import yargs, { InferredOptionTypes } from "yargs";
import { hideBin } from "yargs/helpers";

export function readCLIArgs(): Promise<CLIArgs> {
  return yargs(hideBin(process.argv)).options(cliOptions()).parseAsync();
}

function cliOptions() {
  return {
    inputPath: {
      type: "string",
      alias: "i",
      demandOption: true,
      description: "The file path to read the input figma json data from",
    },
    referenceOutputPath: {
      type: "string",
      alias: "ro",
      default: path.resolve(process.cwd(), "generated/reference.ts"),
      description: "The file path to write the generated reference file to.",
    },
    themeOutputFolder: {
      type: "string",
      alias: "to",
      default: path.resolve(process.cwd(), "generated/themes"),
      description: "The folder to write the generated theme files to.",
    },
    separator: {
      type: "string",
      alias: "s",
      default: "/",
      description:
        "The separator used in the token names to denote hierarchy. " +
        "Each separator will become a nested object in the generated typescript file.",
    },
    codeHeader: {
      type: "string",
      alias: "h",
      description: "The header to add to the top of each generated file.",
      default:
        "// This file was automatically generated. Do not modify it manually.\n\n",
    },
    exitWithNonZeroOnError: {
      type: "boolean",
      alias: "nz",
      default: false,
      description: "Exit with a non-zero code if an error occurs.",
    },
    referenceImportName: {
      type: "string",
      alias: "ref",
      default: "__ref__",
      description:
        "The name of the reference file import in the generated theme files",
    },
  } as const;
}

export type CLIArgs = InferredOptionTypes<ReturnType<typeof cliOptions>>;
