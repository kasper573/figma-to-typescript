import * as path from "path";
import * as fs from "fs/promises";
import type { Result } from "./result";
import { err, ok } from "./result";

export class IO {
  constructor(
    private settings: {
      themeOutputFolder: string;
      referenceOutputPath: string;
      nameTransformer?: (name: string) => string;
    },
  ) {}

  async save(
    filename: string,
    typescriptCode: string,
  ): Promise<Result<void, unknown>> {
    try {
      await fs.mkdir(path.dirname(filename), { recursive: true });
      await fs.writeFile(filename, typescriptCode);
      return ok(void 0);
    } catch (e) {
      return err(e);
    }
  }

  fullPathToFile(toTheme?: string) {
    if (!toTheme) {
      return this.referenceFile;
    } else {
      return path.resolve(
        this.settings.themeOutputFolder,
        `${this.settings.nameTransformer?.(toTheme) ?? toTheme}.ts`,
      );
    }
  }

  relativePathToReferenceFile(fromTheme?: string) {
    if (fromTheme === undefined) {
      return ".";
    }
    return path.relative(
      path.dirname(this.fullPathToFile(fromTheme)),
      this.referenceFile,
    );
  }

  get referenceFile() {
    return path.resolve(this.settings.referenceOutputPath);
  }

  log(...args: unknown[]) {
    console.log(...args);
  }
}
