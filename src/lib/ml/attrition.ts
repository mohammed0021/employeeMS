/**
 * Attrition risk inference — server-side only (no `next/*` imports, plain
 * `node:fs`).
 *
 * The model is an OFFLINE training artifact (see models/README.md). This
 * module's contract with the rest of the app is deliberately narrow:
 *  - `loadModel()` returns `null` when the file is absent or invalid — the
 *    caller turns that into an honest 503. Coefficients are NEVER invented,
 *    defaulted or regenerated: a fabricated model would produce confident
 *    risk scores nobody can defend to the employee they flag.
 *  - Everything else (`riskCategory`, `computeRisk`) is pure math over a
 *    validated model, so it is testable without a database or a file.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

/** Relative to `process.cwd()` — same root the Next server runs from. */
const MODEL_RELATIVE_PATH = join("models", "attrition-model.json");

/**
 * The exported model contract (schemaVersion 1). Field semantics — and the
 * feature dictionary — are documented in models/README.md.
 */
const attritionModelSchema = z
  .object({
    schemaVersion: z.literal(1),
    modelName: z.string().min(1),
    version: z.string().min(1),
    trainedAt: z.string().min(1),
    auc: z.number().min(0).max(1).optional(),
    features: z.array(z.string().min(1)).min(1),
    coefficients: z.array(z.number()),
    intercept: z.number(),
    /** Training-set means used to impute missing indicators. */
    defaults: z.record(z.string(), z.number()),
    categories: z.object({ lowBelow: z.number(), highAt: z.number() }),
  })
  .superRefine((model, ctx) => {
    if (model.coefficients.length !== model.features.length) {
      ctx.addIssue({
        code: "custom",
        path: ["coefficients"],
        message: "coefficients must be the same length as features.",
      });
    }
    for (const feature of model.features) {
      if (!(feature in model.defaults)) {
        ctx.addIssue({
          code: "custom",
          path: ["defaults", feature],
          message: `defaults is missing the training mean for "${feature}".`,
        });
      }
    }
    if (model.categories.lowBelow >= model.categories.highAt) {
      ctx.addIssue({
        code: "custom",
        path: ["categories"],
        message: "lowBelow must be strictly below highAt.",
      });
    }
  });

export type AttritionModel = z.infer<typeof attritionModelSchema>;

/**
 * Module-scope cache: the file does not change between requests, and a
 * successful parse is worth reusing. Only validated loads are cached — a
 * missing or corrupt file is re-checked (and logged) on each call, so fixing
 * the file does not require a server restart, while a good one is never
 * re-read.
 */
let cached: AttritionModel | null = null;

/**
 * Read + validate `models/attrition-model.json`.
 *
 * Returns `null` when the file is absent (the expected state before the first
 * training run), unreadable, not JSON, or failing the schema — in every one
 * of those cases the honest answer is "no model", never a made-up one.
 */
export async function loadModel(): Promise<AttritionModel | null> {
  if (cached) return cached;

  let raw: string;
  try {
    raw = await readFile(join(process.cwd(), MODEL_RELATIVE_PATH), "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.error("[attrition] model file could not be read:", error);
    }
    return null;
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    console.error(`[attrition] ${MODEL_RELATIVE_PATH} is not valid JSON.`);
    return null;
  }

  const parsed = attritionModelSchema.safeParse(json);
  if (!parsed.success) {
    console.error(
      "[attrition] model file failed validation:",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
    return null;
  }

  cached = parsed.data;
  return cached;
}

/**
 * Map a probability onto the model's trained category thresholds (defaults
 * 0.33 / 0.66) instead of hard-coding "0.5 is high risk" — the thresholds are
 * part of the exported artifact for exactly this reason.
 */
export function riskCategory(
  score: number,
  model: AttritionModel,
): "LOW" | "MEDIUM" | "HIGH" {
  if (score < model.categories.lowBelow) return "LOW";
  if (score >= model.categories.highAt) return "HIGH";
  return "MEDIUM";
}

export type AttritionContribution = { feature: string; contribution: number };

export type AttritionRisk = {
  /** Sigmoid probability, rounded to 4 decimals for storage/JSON. */
  riskScore: number;
  /** Largest |contribution| first, capped at 4 — what the dashboard explains. */
  topFactors: AttritionContribution[];
};

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function sigmoid(z: number): number {
  // Saturates to 0/1 for large |z| (exp overflows to Infinity, the correct
  // limit) — no NaN path.
  return 1 / (1 + Math.exp(-z));
}

/**
 * Apply the exported logistic model to one employee's inputs.
 *
 * `contribution` is coefficient × (value − training default): it measures how
 * much this employee's deviation from the training mean moved the log-odds,
 * which is what makes a factor worth showing ("low work-life balance", not
 * "the intercept"). Features missing from `inputs` fall back to the training
 * default, contributing exactly 0.
 */
export function computeRisk(
  model: AttritionModel,
  inputs: Record<string, number>,
): AttritionRisk {
  let z = model.intercept;
  const contributions: AttritionContribution[] = [];

  model.features.forEach((feature, index) => {
    const value = feature in inputs ? inputs[feature] : model.defaults[feature];
    const coefficient = model.coefficients[index];
    z += coefficient * value;
    contributions.push({ feature, contribution: coefficient * (value - model.defaults[feature]) });
  });

  const topFactors = contributions
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 4)
    .map(({ feature, contribution }) => ({ feature, contribution: round4(contribution) }));

  return { riskScore: round4(sigmoid(z)), topFactors };
}