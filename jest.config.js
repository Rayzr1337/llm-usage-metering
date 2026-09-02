/** @type {import('jest').Config} */
export default {
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/**/*.test.ts"],
  setupFiles: ["<rootDir>/tests/helpers/setup.ts"],
  // Run Jest in its native ESM mode — matches the project's "type":"module"
  // and Node 24's require(esm) support. ts-jest transpiles via the loader
  // hook and Jest evaluates everything through its ESM loader.
  extensionsToTreatAsEsm: [".ts"],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: "<rootDir>/tsconfig.test.json",
        useESM: true,
      },
    ],
  },
  testTimeout: 30_000,
  maxWorkers: 1,
  forceExit: true,
  detectOpenHandles: false,
};