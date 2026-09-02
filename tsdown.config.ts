import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/server.ts", "prisma/seed.ts"],
  format: ["esm"],
  platform: "node",
  target: "node24",
  outDir: "dist",
  sourcemap: true,
  clean: true,
  unbundle: false,
  outExtension() {
    return {
      js: ".js",
    };
  },
});