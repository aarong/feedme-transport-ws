// Browser and Node transpilation targets
// Browser queries set based on minimum Sauce test version
export default {
  browsers: [
    "ie >= 11",
    "firefox >= 22",
    "chrome >= 29",
    "edge >= 13",
    "safari >= 10",
    "not dead", // Capture any non-tested browsers
    "last 2 versions", // Capture any non-tested browsers
    "> 0.25%" // Capture any non-tested browsers
  ],
  node: ["node >= 6"]
};
