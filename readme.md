# figma-to-typescript

CLI tool to generate a typescript representation of figma variables and styles from json input.

The json input you must provide can be generated using https://github.com/kasper573/figma-plugin-raw-json-exporter.

## Usage

### From source

- Clone this repository
- Make sure you have [NodeJS](https://nodejs.org/en) installed
- Install project dependencies: Run `npm install` from the repository folder.
- Run `npm run start` to start the CLI.

### Via npm

The package is also distributed as an npm binary:

- Run `npx figma-to-typescript` to start the CLI.

> The CLI will give you further feedback from here on what options it supports and what inputs you must provide.

### Programmatic interface

Exposes more options than the CLI.

See the [CodegenOptions](src/generator.ts) type for more information.

```typescript
import { generate } from "figma-to-typescript";

const finishedWithoutErrors = await generate({
  // ... pass in CodegenOptions here
});
```
