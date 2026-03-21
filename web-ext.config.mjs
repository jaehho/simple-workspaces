export default {
  sourceDir: "src",
  artifactsDir: "web-ext-artifacts",
  build: {
    overwriteDest: true,
  },
  run: {
    startUrl: ["about:debugging#/runtime/this-firefox"],
    browserConsole: true,
  },
  ignoreFiles: [
    "**/*.md",
  ],
};
