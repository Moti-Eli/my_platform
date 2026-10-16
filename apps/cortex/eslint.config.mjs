import nextPlugin from "@next/eslint-plugin-next";

// ESLint flat config (ESLint 9), mirroring apps/web: use
// @next/eslint-plugin-next's native flat rules directly.
const eslintConfig = [
  {
    plugins: {
      "@next/next": nextPlugin,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
    },
  },
  {
    ignores: [".next/**", "node_modules/**", "public/sw.js"],
  },
];

export default eslintConfig;
