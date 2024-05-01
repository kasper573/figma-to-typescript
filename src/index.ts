import * as path from "path";
import { generate } from "./generator";
import { readCLIArgs } from "./cli";

// Initialize the CLI if this script is run directly

if (require.main === module) {
  readCLIArgs().then(async ({ themeOutputFolder, ...args }) => {
    const ok = await generate({
      ...args,
      themeOutputPath: (themeName) =>
        path.resolve(themeOutputFolder, `${themeName}.ts`),
    });

    if (!ok && args.exitWithNonZeroOnError) {
      process.exit(1);
    }
  });
}

// Export the programmatic API

export * from "./generator";
export * from "./cli";
