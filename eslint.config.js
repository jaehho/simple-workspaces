import globals from "globals";
import noUnsanitized from "eslint-plugin-no-unsanitized";

export default [
  {
    files: ["src/**/*.js"],
    ignores: ["src/background/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: {
        ...globals.browser,
        ...globals.webextensions,
      },
    },
    plugins: {
      "no-unsanitized": noUnsanitized,
    },
    rules: {
      // Mozilla security rules — prevent XSS via innerHTML/outerHTML
      "no-unsanitized/method": "error",
      "no-unsanitized/property": "error",

      // Standard quality rules
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-var": "warn",
      "prefer-const": "warn",
      "eqeqeq": ["warn", "smart"],
    },
  },
  {
    files: ["src/background/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.webextensions,
      },
    },
    plugins: {
      "no-unsanitized": noUnsanitized,
    },
    rules: {
      // Mozilla security rules — prevent XSS via innerHTML/outerHTML
      "no-unsanitized/method": "error",
      "no-unsanitized/property": "error",

      // Standard quality rules
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-var": "warn",
      "prefer-const": "warn",
      "eqeqeq": ["warn", "smart"],
    },
  },
];
