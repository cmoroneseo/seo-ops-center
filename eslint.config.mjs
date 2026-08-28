import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  {
    ignores: [
      // Nested too: a git worktree carries its own .next, and the bare
      // ".next/**" pattern only ever matched the one at the repo root.
      "**/.next/**",
      ".next/**",
      // Worktrees are separate checkouts of this same codebase. Linting them
      // from here reported every file two or three times over and buried the
      // repo's own findings — 594 of 648 files linted were worktree copies.
      ".worktrees/**",
      ".claude/**",
      "node_modules/**",
      "coverage/**",
      "dist/**",
      "out/**",
      "next-env.d.ts",
      "Sheet App Scrips/**"
    ]
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "warn",
      "react/no-unescaped-entities": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@next/next/no-async-client-component": "off"
    }
  }
];

export default eslintConfig;
