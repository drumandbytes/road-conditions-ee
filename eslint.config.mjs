import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "**/.wrangler/**"] },
  tseslint.configs.recommended,
  {
    rules: {
      // Workers log via console; not a lint concern
      "no-console": "off",
      // Allow intentionally-unused params/vars prefixed with _ (used throughout the
      // not-yet-implemented Phase 3/4 route stubs)
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
);
