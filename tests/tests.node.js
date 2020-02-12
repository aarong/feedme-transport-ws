var copyFileSync = require("fs-copy-file-sync"); // Not in Node 6
var prependFile = require("prepend-file");
var Jasmine = require("jasmine");
var path = require("path");
var fs = require("fs");
var jsStringEscape = require("js-string-escape");
var feedmeTransportWsServer = require("../build/server");

// Copy tests/node.js to tmp/node.js
copyFileSync(__dirname + "/tests.js", __dirname + "/node.tmp.js");

// Prepend the module load to the tests
var buildPath = path.normalize(path.join(__dirname, "../build/client.node"));
var header =
  "var feedmeTransportWsClient = require('" +
  jsStringEscape(buildPath) +
  "');\n\n";
prependFile.sync(__dirname + "/node.tmp.js", header);

// Start a transport server
const transportServer = feedmeTransportWsServer({});

// Run the tests in Jasmine
var jasmine = new Jasmine();
jasmine.loadConfig({
  spec_dir: ".",
  spec_files: [__dirname + "/node.tmp.js"]
});
jasmine.onComplete(function(passed) {
  // Delete the temp file
  fs.unlinkSync(__dirname + "/node.tmp.js");

  // The return code for this script must be non-zero if tests fail (Travis fail)
  if (!passed) {
    process.exit(1);
  }
});
jasmine.execute();
