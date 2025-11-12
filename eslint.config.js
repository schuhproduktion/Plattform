const { FlatCompat } = require("@eslint/eslintrc");
const js = require("@eslint/js");

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

module.exports = compat.config({
  root: true,
  env: {
    browser: true,
    node: true,
    es2023: true,
  },
  extends: ["eslint:recommended", "prettier"],
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
  ignorePatterns: ["node_modules/", "frontend/public/locales/", "uploads/", "docs/"],
  overrides: [
    {
      files: ["backend/**/*.js"],
      env: {
        node: true,
        browser: false,
      },
    },
    {
      files: ["frontend/public/**/*.js"],
      env: {
        browser: true,
        node: false,
      },
    },
    {
      files: ["tests/**/*.js"],
      env: {
        node: true,
        browser: false,
      },
    },
  ],
});
