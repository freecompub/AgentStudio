import react from "@vitejs/plugin-react";
import { defineProject } from "vitest/config";

export default defineProject({
  plugins: [react()],
  test: {
    name: "desktop",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    environment: "node",
    setupFiles: ["./test/setup-renderer.ts"],
  },
});
