const path = require("path");

// One build with source maps and one without
module.exports = [true, false].map(sourceMaps => ({
  entry: "./src/browser.js",
  mode: "production",

  module: {
    rules: [
      {
        test: /\.js$/,

        // Bundle will not work if you transpile webpack or core-js polyfills
        // https://stackoverflow.com/questions/57361439/how-to-exclude-core-js-using-usebuiltins-usage
        // https://github.com/zloirock/core-js/issues/743
        exclude: [
          /\bnode_modules[\\/]{1}core-js\b/, // Allow slash or backslash
          /\bnode_modules[\\/]{1}webpack\b/
        ],

        use: {
          loader: "babel-loader",
          options: {
            // Specify all Babel configuration here
            babelrc: false,

            // Fixes "TypeError: __webpack_require__(...) is not a function"
            // https://github.com/webpack/webpack/issues/9379#issuecomment-509628205
            // https://babeljs.io/docs/en/options#sourcetype
            sourceType: "unambiguous",

            presets: [
              [
                "@babel/preset-env",
                {
                  // Webpack supports ES modules out of the box
                  // Do not transform to CJS or anything else or you break tree-shaking
                  modules: false,

                  // Adds specific imports for polyfills when they are used
                  useBuiltIns: "usage",
                  corejs: {
                    version: "3",
                    proposals: true
                  }

                  // Verbose preset-env output
                  // debug: true
                }
              ]
            ]
          }
        }
      }
    ]
  },

  output: {
    filename: sourceMaps ? "browser.bundle.withmaps.js" : "browser.bundle.js",
    path: path.resolve(__dirname, "build"),
    library: "feedmeTransportWsClient",
    libraryExport: "default", // No feedmeTransportWsClient.default()
    libraryTarget: "umd"
  },

  optimization: {
    minimize: true
  },

  // If you use the "source-maps" option you get correct line number references
  // but names in stack traces are the minified ones
  // If you use "eval-source-maps" you get correct names in stack traces but
  // the bundle fails on older browsers
  devtool: sourceMaps ? "source-maps" : false,

  // Suppress file size warnings
  performance: {
    maxAssetSize: 400000,
    maxEntrypointSize: 400000
  }

  // Detailed Webpack info
  // stats: "verbose"
}));
