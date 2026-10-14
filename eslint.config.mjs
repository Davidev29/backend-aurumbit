export default [
  {
    ignores: ["node_modules/**", "dist/**", "**/dist/**", "pgdata/**"]
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module"
    },
    rules: {}
  }
];
