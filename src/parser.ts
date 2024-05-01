import { z } from "zod";

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

const nameSchema = (separator: string) =>
  z.string().transform((value) => value.split(separator));

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

const variableSchema = (separator: string) => {
  return z
    .object({
      id: z.string(),
      name: nameSchema(separator),
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

export type TextStyle = z.infer<ReturnType<typeof textStyleSchema>>;
const textStyleSchema = (separator: string) =>
  z.object({
    name: nameSchema(separator),
    lineHeight: z
      .object({
        unit: valueSchema,
        value: valueSchema,
      })
      .or(valueSchema)
      .optional(),
    fontSize: valueSchema.optional(),
    fontFamily: valueSchema.optional(),
    fontStyle: valueSchema.optional(),
  });

export type ShadowEffect = z.infer<typeof shadowEffectSchema>;
const shadowEffectSchema = z.object({
  type: z.enum(["DROP_SHADOW", "INNER_SHADOW"]),
  spread: valueSchema.optional(),
  radius: valueSchema.optional(),
  color: valueSchema.optional(),
  offset: z.object({ x: valueSchema, y: valueSchema }).partial().optional(),
});

const ignoredEffectSchema = z.object({
  type: z.enum(["BACKGROUND_BLUR", "LAYER_BLUR"]),
});

export type Effect = z.infer<typeof effectSchema>;
const effectSchema = z.discriminatedUnion("type", [
  shadowEffectSchema,
  ignoredEffectSchema,
]);

export type EffectStyle = z.infer<ReturnType<typeof effectStyleSchema>>;
const effectStyleSchema = (separator: string) =>
  z.object({
    name: nameSchema(separator),
    effects: z.array(effectSchema),
  });

export type FigmaData = z.infer<ReturnType<typeof figmaDataSchema>>;
export const figmaDataSchema = (separator: string) =>
  z.object({
    variables: z.array(variableSchema(separator)),
    textStyles: z.array(textStyleSchema(separator)),
    effectStyles: z.array(effectStyleSchema(separator)),
  });
