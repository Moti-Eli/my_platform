import nextPlugin from "@next/eslint-plugin-next";

// ESLint flat config (ESLint 9). We use @next/eslint-plugin-next's native flat
// rules directly rather than the legacy `eslint-config-next` via FlatCompat,
// which fails to serialize its bundled plugins under ESLint 9.
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
    ignores: [".next/**", "node_modules/**"],
  },
];

export default eslintConfig;
