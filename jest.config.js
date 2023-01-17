/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  clearMocks: true,
  collectCoverage: true,
  // An array of glob patterns indicating a set of files for which coverage information should be collected
  // collectCoverageFrom: undefined,

  coverageDirectory: "coverage",
  coveragePathIgnorePatterns: [
    "\\\\node_modules\\\\"
  ],
  coverageProvider: "v8",
  coverageReporters: [
    "lcov",
  ],
  preset: 'ts-jest',
  testEnvironment: 'node'
  // An object that configures minimum threshold enforcement for coverage results
  // coverageThreshold: undefined,
};
