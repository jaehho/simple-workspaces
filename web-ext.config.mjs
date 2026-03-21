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
  sign: {
    channel: "listed",
    amoMetadata: "amo-metadata.json",
  },
  ignoreFiles: [
    "**/*.md",
  ],
};
