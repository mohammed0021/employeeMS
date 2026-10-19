import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  // Neon Auth service is not used — the app implements its own session auth.
  auth: false,
  // Branch policy: per-branch tuning
  branch: (branch) => {
    // Postgres is the primary datastore (Prisma 7 + @prisma/adapter-pg).
    // Free-tier-friendly: autoscale within 0.25–1 CU.
    // (suspendTimeout is omitted: the free tier forbids modifying the
    // suspend interval — the API rejects it with HTTP 412.)
    // `as const` keeps the CU literals as 0.25 / 1 (not widened to number),
    // which the BranchTuning type requires.
    const postgres = {
      computeSettings: {
        autoscalingLimitMinCu: 0.25,
        autoscalingLimitMaxCu: 1,
      },
    } as const;
    if (branch.isDefault) {
      // Default branch: no overrides, uses project defaults
      return { postgres };
    }
    if (!branch.exists) {
      // New non-default branches: auto-expire
      // Run `neon checkout <name>` to create a new branch with these settings
      return { ttl: "7d", postgres };
    }
    // Existing branch: no changes
    return { postgres };
  },
});
