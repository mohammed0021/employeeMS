# Attrition model (offline training artifact)

This directory holds **one** file: `attrition-model.json`, produced by an
offline training run. It is deliberately **not** committed and **never**
fabricated at runtime: when it is missing, `src/lib/ml/attrition.ts` returns
`null` and `POST /api/attrition/run` answers an honest
`503 ATTRITION_MODEL_MISSING` telling the operator how to train one.

## JSON contract (`models/attrition-model.json`)

```jsonc
{
  "schemaVersion": 1,                 // must be exactly 1 — loadModel() rejects anything else
  "modelName": "attrition-logreg",    // informational, stored on each AttritionSignal
  "version": "1.0.0",                 // bump when retrained, stored on each signal
  "trainedAt": "2026-10-19T12:00:00+00:00", // ISO-8601 UTC
  "auc": 0.84,                        // optional test-set ROC-AUC (0..1)
  "features": [                       // EXACT order of inference —
    "overtime",                       // coefficients[i] multiplies features[i]
    "jobSatisfaction",
    "workLifeBalance",
    "environmentSatisfaction",
    "trainingTimesLastYear",
    "yearsSinceLastPromotion",
    "tenureYears"
  ],
  "coefficients": [0.9, -0.3, -0.2, -0.1, -0.15, 0.1, -0.05], // same length as features
  "intercept": -0.4,
  "defaults": {                       // training-set means, per feature, for imputing
    "overtime": 0.28,                 // employees without an AttritionIndicator row
    "jobSatisfaction": 2.7,
    "workLifeBalance": 2.7,
    "environmentSatisfaction": 2.7,
    "trainingTimesLastYear": 2.8,
    "yearsSinceLastPromotion": 4.1,
    "tenureYears": 7.0
  },
  "categories": {                     // riskScore thresholds used by riskCategory()
    "lowBelow": 0.33,                 // score <  lowBelow            → LOW
    "highAt": 0.66                    // score >= highAt              → HIGH, else MEDIUM
  }
}
```

`src/lib/ml/attrition.ts` parses this with a Zod schema and additionally
checks that `coefficients.length === features.length`, that `defaults`
contains an entry for every feature, and that `lowBelow < highAt`. A file that
fails validation is treated as absent (`null`) — never partially used.

## Feature dictionary

| feature                   | type      | range / meaning                                        |
| ------------------------- | --------- | ------------------------------------------------------ |
| `overtime`                | 0/1       | works overtime (indicator `overtime`, true → 1)        |
| `jobSatisfaction`         | int 1..5  | self/experience satisfaction score                     |
| `workLifeBalance`         | int 1..5  | work-life balance score                                |
| `environmentSatisfaction` | int 1..5  | workplace environment score                            |
| `trainingTimesLastYear`   | int 0..50 | number of training sessions in the last year           |
| `yearsSinceLastPromotion` | int 0..50 | years since the last promotion                         |
| `tenureYears`             | float     | derived from `Employee.joinDate` → today, in years     |

All except `tenureYears` come from the `AttritionIndicator` row (or the model
defaults when the row is missing). `tenureYears` is always derived from the
employee record — it is a fact about the employee, not an HR-entered input,
so it is never imputed.

## Generating the model (Python — not installed on this machine)

The training script lives at `scripts/train-attrition.py`. It requires
`pandas` and `scikit-learn`:

```bash
pip install pandas scikit-learn
python scripts/train-attrition.py --data path/to/HR-Employee-Attrition.csv
```

What it does:

1. Loads the IBM HR Analytics Employee Attrition & Performance CSV
   (Kaggle: `WA_Fn-UseC_-HR-Employee-Attrition.csv`).
2. Maps the dataset's columns onto the feature dictionary above exactly
   (`OverTime` Yes/No → 1/0, `YearsAtCompany` → `tenureYears`, …).
3. Trains `LogisticRegression(class_weight="balanced")` on a stratified
   train/test split and prints the test ROC-AUC.
4. Writes `models/attrition-model.json` in the shape documented here:
   coefficients and intercept from the fitted model, `defaults` as the
   **training-set** means, `trainedAt` as an ISO-8601 UTC timestamp, and the
   category thresholds `0.33 / 0.66`.

Options: `--out` (output path, default `models/attrition-model.json`),
`--version`, `--model-name`, `--test-size`, `--seed`.

Inference afterwards is pure TypeScript (`src/lib/ml/attrition.ts`): the
runtime never fits, re-derives or guesses coefficients — it only applies the
exported ones.
