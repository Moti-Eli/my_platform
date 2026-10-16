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
      // React Compiler rules (react-hooks v7) that flag existing code. Each one
      // needs a behaviour-level fix, not a lint tweak, so they warn until fixed
      // one by one; do not add new violations.
      "react-hooks/refs": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  {
    ignores: [".next/**", "node_modules/**", "public/sw.js", "next-env.d.ts"],
  },
];

export default eslintConfig;
