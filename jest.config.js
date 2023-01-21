/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  clearMocks: true,
  collectCoverage: true,
  // An array of glob patterns indicating a set of files for which coverage information should be collected
  // collectCoverageFrom: undefined,

  coverageDirectory: "coverage",
  coveragePathIgnorePatterns: [
    "\\\\node_modules\\\\",
    "\\\\out\\\\",
  ],
  coverageProvider: "v8",
  coverageReporters: [
    "lcov",
  ],
  preset: 'ts-jest',
  testEnvironment: 'node',
  maxWorkers: 1,
  moduleDirectories: ["node_modules"],
};
