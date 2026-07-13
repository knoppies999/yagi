// ESLint 9 flat config. Two type-checked blocks, one per compilation world
// (src/ host + webview/ UI). `projectService: true` lets typescript-eslint
// discover each tsconfig automatically. Start from recommendedTypeChecked,
// not strict — the gate is "passes", not a style war.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

// The extension host models webview messages as `msg: any` and errors as
// `catch (err: any)` — a single untyped boundary that fans out into ~95
// no-unsafe-*/no-explicit-any findings. Re-typing that boundary (a discriminated
// `OutMsg` handler + `unknown` catch clauses) is a real refactor, out of scope
// for "add a passing lint gate". Disable the `any`-driven family here and track
// re-enabling it as a follow-up.
const anyBoundaryRulesOff = {
  "@typescript-eslint/no-explicit-any": "off",
  "@typescript-eslint/no-unsafe-member-access": "off",
  "@typescript-eslint/no-unsafe-argument": "off",
  "@typescript-eslint/no-unsafe-assignment": "off",
  "@typescript-eslint/no-unsafe-call": "off",
  "@typescript-eslint/no-unsafe-return": "off",
  "@typescript-eslint/restrict-template-expressions": "off",
};

export default tseslint.config(
  {
    // Build output, vendored bundles, and packaging artifacts. Test files are
    // excluded from the type-aware lint too: the host build tsconfig excludes
    // them (so they don't emit into out/), which leaves the typescript-eslint
    // project service unable to type them — and Vitest already validates them.
    ignores: [
      "out/**",
      "media/**",
      "node_modules/**",
      "*.vsix",
      "esbuild.js",
      "eslint.config.mjs",
      "**/*.test.ts",
      "**/*.test.tsx",
      "src/test/**",
    ],
  },
  // Extension host: Node/CommonJS.
  {
    files: ["src/**/*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: globals.node,
    },
    rules: { ...anyBoundaryRulesOff },
  },
  // Webview: browser/React.
  {
    files: ["webview/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: globals.browser,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...anyBoundaryRulesOff,
      // eslint-plugin-react-hooks v7's recommended set ships two experimental
      // React-Compiler rules that flag correct-but-unfashionable patterns the
      // codebase relies on (a latest-value `layoutRef.current = layout` sync
      // during render, and mutually-referential pointer handlers). Fixing them
      // means restructuring working hooks — out of scope. The load-bearing
      // rules (rules-of-hooks, exhaustive-deps) stay on.
      "react-hooks/refs": "off",
      "react-hooks/immutability": "off",
    },
  }
);
