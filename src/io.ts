import * as path from "path";
import * as fs from "fs/promises";
import type { Result } from "./result";
import { err, ok } from "./result";

export class IO {
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

  log(...args: unknown[]) {
    console.log(...args);
  }
}
