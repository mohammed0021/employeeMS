#!/usr/bin/env python3
"""
Train the attrition model consumed by src/lib/ml/attrition.ts.

The TypeScript side never fits or invents coefficients — it only applies the
JSON file this script writes (contract documented in models/README.md). Until
that file exists, POST /api/attrition/run answers 503 ATTRITION_MODEL_MISSING.

Requires pandas + scikit-learn (NOT installed on the dev machine — run this
elsewhere or in a venv):

    pip install pandas scikit-learn
    python scripts/train-attrition.py --data path/to/HR-Employee-Attrition.csv

Dataset: IBM HR Analytics Employee Attrition & Performance
(Kaggle: WA_Fn-UseC_-HR-Employee-Attrition.csv).

Usage:
    python scripts/train-attrition.py --data <csv> [--out models/attrition-model.json]
                                      [--model-name attrition-logreg]
                                      [--version 1.0.0] [--test-size 0.2] [--seed 42]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone

import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import train_test_split

# Must match src/lib/ml/attrition.ts / models/README.md — order is inference
# order: coefficients[i] multiplies features[i].
FEATURES = [
    "overtime",
    "jobSatisfaction",
    "workLifeBalance",
    "environmentSatisfaction",
    "trainingTimesLastYear",
    "yearsSinceLastPromotion",
    "tenureYears",
]

# Category thresholds exported with the model (riskCategory() reads them).
LOW_BELOW = 0.33
HIGH_AT = 0.66

TARGET = "Attrition"

# IBM dataset column -> feature (see models/README.md feature dictionary).
# tenureYears has no direct column: YearsAtCompany is the dataset's equivalent
# of the app's derived Employee.joinDate -> today tenure.
SOURCE_COLUMNS = {
    "overtime": "OverTime",
    "jobSatisfaction": "JobSatisfaction",
    "workLifeBalance": "WorkLifeBalance",
    "environmentSatisfaction": "EnvironmentSatisfaction",
    "trainingTimesLastYear": "TrainingTimesLastYear",
    "yearsSinceLastPromotion": "YearsSinceLastPromotion",
    "tenureYears": "YearsAtCompany",
}


def die(message: str) -> None:
    print(f"error: {message}", file=sys.stderr)
    sys.exit(1)


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    """Map the raw CSV onto the exact feature dictionary, in order."""
    missing = [
        col for col in list(SOURCE_COLUMNS.values()) + [TARGET] if col not in df.columns
    ]
    if missing:
        die(f"dataset is missing required column(s): {', '.join(sorted(set(missing)))}")

    out = pd.DataFrame(index=df.index)

    # OverTime is "Yes"/"No" in the IBM dataset -> 0/1.
    overtime = df["OverTime"].astype(str).str.strip().str.lower().map({"yes": 1, "no": 0})
    if overtime.isna().any():
        bad = sorted(df.loc[overtime.isna(), "OverTime"].astype(str).unique())
        die(f"unexpected OverTime value(s): {', '.join(bad)} (expected Yes/No)")
    out["overtime"] = overtime.astype(float)

    for feature, column in SOURCE_COLUMNS.items():
        if feature == "overtime":
            continue
        out[feature] = pd.to_numeric(df[column], errors="coerce").astype(float)

    if out[FEATURES].isna().any().any():
        columns = out[FEATURES].columns[out[FEATURES].isna().any()].tolist()
        die(f"non-numeric value(s) in column(s): {', '.join(columns)}")

    # In-range sanity checks mirroring the app's Zod schemas (1..5 scales,
    # counts >= 0) so a bad CSV fails here instead of producing a nonsense model.
    for feature in ("jobSatisfaction", "workLifeBalance", "environmentSatisfaction"):
        if not out[feature].between(1, 5).all():
            die(f"{feature} must be within 1..5.")
    for feature in ("trainingTimesLastYear", "yearsSinceLastPromotion", "tenureYears"):
        if (out[feature] < 0).any():
            die(f"{feature} must not be negative.")

    return out[FEATURES]


def build_target(df: pd.DataFrame) -> pd.Series:
    """Attrition Yes/No -> 1/0."""
    target = df[TARGET].astype(str).str.strip().str.lower().map({"yes": 1, "no": 0})
    if target.isna().any():
        die(f"unexpected {TARGET} value(s) (expected Yes/No)")
    return target.astype(int)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Train the attrition logistic model and export models/attrition-model.json."
    )
    parser.add_argument("--data", required=True, help="Path to the IBM HR attrition CSV.")
    parser.add_argument(
        "--out",
        default=os.path.join("models", "attrition-model.json"),
        help="Output JSON path (default: models/attrition-model.json).",
    )
    parser.add_argument("--model-name", default="attrition-logreg")
    parser.add_argument("--version", default="1.0.0")
    parser.add_argument("--test-size", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    try:
        df = pd.read_csv(args.data)
    except FileNotFoundError:
        die(f"data file not found: {args.data}")

    X = build_features(df)
    y = build_target(df)
    if len(X) < 50:
        die(f"dataset too small to train on: {len(X)} rows")

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=args.test_size, random_state=args.seed, stratify=y
    )

    # class_weight="balanced": attrition is the minority class, and a review
    # that misses leavers is worse than one with a few false alarms.
    model = LogisticRegression(class_weight="balanced", max_iter=1000, random_state=args.seed)
    model.fit(X_train, y_train)

    auc = roc_auc_score(y_test, model.predict_proba(X_test)[:, 1])
    print(f"test ROC-AUC: {auc:.4f}  ({len(X_test)} holdout rows, {len(X_train)} train rows)")

    # Imputation defaults are TRAINING-SET means (never test-set leakage).
    defaults = {feature: float(X_train[feature].mean()) for feature in FEATURES}

    payload = {
        "schemaVersion": 1,
        "modelName": args.model_name,
        "version": args.version,
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "auc": float(auc),
        "features": list(FEATURES),
        "coefficients": [float(c) for c in model.coef_.ravel()],
        "intercept": float(model.intercept_.ravel()[0]),
        "defaults": defaults,
        "categories": {"lowBelow": LOW_BELOW, "highAt": HIGH_AT},
    }

    assert len(payload["coefficients"]) == len(FEATURES)
    assert set(defaults) == set(FEATURES)

    out_dir = os.path.dirname(os.path.abspath(args.out))
    os.makedirs(out_dir, exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=False)
        handle.write("\n")

    print(f"wrote {args.out} ({args.model_name} v{args.version})")


if __name__ == "__main__":
    main()
