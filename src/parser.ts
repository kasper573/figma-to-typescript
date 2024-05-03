import { ZodType, z } from "zod";

export type VariableAlias = z.infer<typeof variableAliasSchema>;
const variableAliasSchema = z.object({
  type: z.literal("alias"),
  id: z.string(),
});

export type Color = RGBA | RGB;

export type RGBA = z.infer<typeof rgbaSchema>;
const rgbaSchema = z.object({
  type: z.literal("rgba"),
  r: z.number(),
  g: z.number(),
  b: z.number(),
  a: z.number(),
});

export type RGB = z.infer<typeof rgbSchema>;
const rgbSchema = z.object({
  type: z.literal("rgb"),
  r: z.number(),
  g: z.number(),
  b: z.number(),
});

export type Value = z.infer<typeof valueSchema>;
export const valueSchema = z.discriminatedUnion("type", [
  variableAliasSchema,
  z.object({ type: z.literal("boolean"), value: z.boolean() }),
  z.object({ type: z.literal("string"), value: z.string() }),
  z.object({ type: z.literal("number"), value: z.number() }),
  rgbaSchema,
  rgbSchema,
]);

export function isValue(input: unknown): input is Value {
  return valueSchema.safeParse(input).success;
}

export type ValueNode = Value | ValueRecord | undefined;
const valueNodeSchema: ZodType<ValueNode> = z.lazy(() =>
  valueSchema.or(valueRecordSchema).or(
    // Treat all invalid values as undefined
    z.any().transform(() => undefined),
  ),
);

export type ValueRecord = { [key: string]: ValueNode };
const valueRecordSchema: ZodType<ValueRecord> = z.record(valueNodeSchema);

const nameSchema = (nameParser: NameParser) => z.string().transform(nameParser);

export type Variable = {
  id: string;
  name: string[];
} & (
  | {
      isShared: true;
      value: Value;
    }
  | {
      isShared: false;
      themeValues: Record<string, Value>;
    }
);

const variableSchema = (nameParser: NameParser) => {
  return z
    .object({
      id: z.string(),
      name: nameSchema(nameParser),
      collection: z.string(),
      valuesByMode: z.record(valueSchema),
    })
    .transform(({ valuesByMode, name, id }): Variable => {
      const values = Object.values(valuesByMode);
      if (!values.length) {
        throw new Error(`A variable must have at least one value`);
      }

      const base = { id, name };
      if (values.length === 1) {
        return {
          ...base,
          isShared: true,
          value: values[0],
        };
      }

      return {
        ...base,
        isShared: false,
        themeValues: valuesByMode,
      };
    });
};

export type TextStyle = { name: string[]; props: ValueRecord };
const textStyleSchema = (nameParser: NameParser) => {
  const ns = nameSchema(nameParser);
  return z.any().transform(
    ({ name, ...rest }): TextStyle => ({
      name: ns.parse(name),
      props: valueRecordSchema.parse(rest),
    }),
  );
};

export type EffectStyle = z.infer<ReturnType<typeof effectStyleSchema>>;
const effectStyleSchema = (nameParser: NameParser) =>
  z.object({
    name: nameSchema(nameParser),
    effects: z.array(valueRecordSchema),
  });

export type FigmaData = z.infer<ReturnType<typeof figmaDataSchema>>;
export const figmaDataSchema = (nameParser: NameParser) =>
  z.object({
    variables: z.array(variableSchema(nameParser)),
    textStyles: z.array(textStyleSchema(nameParser)),
    effectStyles: z.array(effectStyleSchema(nameParser)),
    // TODO grid and paint styles
  });

export type NameParser = (name: string) => string[];
