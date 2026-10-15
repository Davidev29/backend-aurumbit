import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import nextPlugin from "@next/eslint-plugin-next";

// Fase 1: gate de parse (sem regras habilitadas). Os plugins abaixo existem
// apenas para que as diretivas `eslint-disable-next-line <regra>` já
// espalhadas no código (react-hooks, @typescript-eslint, @next/next)
// resolvam para regras reais em vez de quebrar o lint com
// "Definition for rule ... was not found". Habilitar regras de verdade é
// trabalho futuro (quando isso acontecer, os disables já estão no lugar).
export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "**/dist/**",
      "pgdata/**",
      "**/.next/**",
      "**/out/**",
      "**/coverage/**",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "react-hooks": reactHooks,
      "@next/next": nextPlugin,
    },
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {},
  },
];
