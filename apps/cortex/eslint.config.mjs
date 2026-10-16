import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// ESLint flat config (ESLint 9): Next's official presets. core-web-vitals
// brings the Next, React, react-hooks, import and jsx-a11y rules; typescript
// adds the TS parser and typescript-eslint rules. (The previous hand-rolled
// config had no parser or `files` for .ts/.tsx, so `eslint .` silently skipped
// every TypeScript file.)
const eslintConfig = [
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Intent inputs that take nothing are declared as empty interfaces on
      // purpose (`export interface QueryListInput {}`), one named Input type per
      // intent per docs/Cortex-SubApp-Standard.md.
      "@typescript-eslint/no-empty-object-type": ["error", { allowInterfaces: "always" }],
      // A leading underscore marks a parameter the contract signature requires
      // but this implementation doesn't use (`_ctx`, `_emit`, `_props`, `_logic`).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      // React Compiler rule (react-hooks v7) that still flags 4 existing sites
      // (AppShell overlay reset, useInstalledApps/usePinnedApps hydration gates,
      // CandidateAnswers reload). Each needs a behaviour-level fix verified in a
      // preview, so it warns until then; do not add new violations.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  {
    ignores: [".next/**", "node_modules/**", "public/sw.js", "next-env.d.ts"],
  },
];

export default eslintConfig;
