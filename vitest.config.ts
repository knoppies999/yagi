import { defineConfig } from "vitest/config";

// Two projects, one runner. The host world is pure Node; the webview world
// needs a DOM (jsdom) for React component tests. Test files import vitest
// APIs explicitly (no globals) so neither tsconfig needs vitest type injection.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "host",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "webview",
          environment: "jsdom",
          include: ["webview/**/*.test.{ts,tsx}"],
        },
      },
    ],
  },
});
