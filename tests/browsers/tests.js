var copyFileSync = require("fs-copy-file-sync"); // Not in Node 6
var express = require("express");
var sauceConnectLauncher = require("sauce-connect-launcher");
var async = require("async");
var request = require("request");
var ws = require("ws");
var feedmeServerCore = require("feedme-server-core");
var feedmeTransportWsServer = require("../../build/server");

var webserver;
var sauceConnectProcess;
var sauceTests;
var sauceResults;

// Running locally or on Sauce?
var localMode = false;
if (process.argv.length >= 3 && process.argv[2].toLowerCase() === "local") {
  localMode = true;
}

// Require Sauce credentials if you're not running locally
if (
  !localMode &&
  (!process.env.SAUCE_USERNAME || !process.env.SAUCE_ACCESS_KEY)
) {
  throw new Error(
    "NO_CREDENTIALS: The SAUCE_USERNAME or SAUCE_ACCESS_KEY environmental variable is missing."
  );
}

// Config
var port = 3000;
var sauceTunnelId =
  process.env.TRAVIS_JOB_NUMBER || "feedme-transport-ws-tunnel"; // Travis sets tunnel id to job number
var pollInterval = 10000;
saucePlatforms = [
  // Available Sauce platforms: https://saucelabs.com/platforms
  // General approach is to tests earliest and latest browser versions available on all platforms

  // If you include a bad platform-browser combination, Sauce never returns results even when
  // the good ones are done, and does not return an error either (bad tests not listed on dashboard)

  // REST API only supports desktop platforms, not mobile (confirmed with support)
  // For mobile platforms you need to use Appium directly (see their platform
  // configurator), or one of their testing frameworks:
  // https://github.com/saucelabs-sample-test-frameworks

  // Firefox 66 (latest) on Mac and Windows (but not Linux) was running the tests successfully
  // and printing the results to console, but the tests would never return, as
  // though Sauce never knew that the browser was "finished". Same problem on
  // Firefox 60, worked on 50, problem on 55, worked on 52, worked on 53, worked on 54 (hardcoded).

  // WebSockets introduced in FireFox 11, but fails with ws:// URL (illegal string) in 17 and below
  ["Windows 10", "Firefox", "18"],

  // Was 54, latest (73) looked successful but didn't return
  // 55 works, 65 works but hangs, 60 hangs, 57 hangs, 56 hangs
  ["Windows 10", "Firefox", "55"],

  ////// ["Windows 10", "Chrome", "26"],
  ["Windows 10", "Chrome", "latest"],
  ////// ["Windows 10", "MicrosoftEdge", "13"], // Failing 1006: https://github.com/aarong/sauce-connect-proxy-problem
  ////// ["Windows 10", "MicrosoftEdge", "latest"], // Failing 1006: https://github.com/aarong/sauce-connect-proxy-problem
  ["Windows 10", "Internet Explorer", "11"],
  ["Windows 8", "Internet Explorer", "10"],

  // IE 9 does not support Jasmine
  // ["Windows 7", "Internet Explorer", "9"],

  // macOS 10.14 tests get 500 error - what is localhost:3000 pointing to? Sauce Connect issue?
  // ["macOS 10.14", "Safari", "latest"],
  // ["macOS 10.14", "Firefox", "latest"],
  // ["macOS 10.14", "Chrome", "latest"],
  ["macOS 10.13", "Firefox", "54"], // Hangs on 55+ (Jasmine, I think), 1006 on 65+
  ////// ["macOS 10.13", "Chrome", "latest"], // Failing 1006: https://github.com/aarong/sauce-connect-proxy-problem
  // Safari tests hang - Jasmine results show in the browser and there are
  // no console errors, but Sauce doesn't return
  // ["macOS 10.13", "Safari", "latest"],
  // ["macOS 10.13", "Safari", "11"],
  // ["macOS 10.12", "Safari", "10"],

  // macOS 10.10, 10.11 would not spawn tests (missing and hang like bad combo)

  ["Linux", "Firefox", "latest"],
  ["Linux", "Chrome", "latest"]
];

// Run the tests
async.series(
  [
    function(cb) {
      // Set up the webroot with built client.bundle.withmaps
      copyFileSync(
        __dirname + "/../../build/browser.bundle.withmaps.js",
        __dirname + "/webroot/browser.bundle.withmaps.js"
      );
      copyFileSync(
        __dirname + "/../../build/browser.bundle.withmaps.js.map",
        __dirname + "/webroot/browser.bundle.withmaps.js.map"
      );

      cb();
    },
    function(cb) {
      // Start the local webserver (adapted from Jasmine-standalone)
      console.log("Starting local webserver to host the tests...");
      var e = express();
      e.use("/", express.static(__dirname + "/webroot"));

      webserver = e.listen(port, function() {
        console.log("Local server started on http://localhost:" + port);

        cb();
      });

      var fmServer = feedmeServerCore({
        transport: feedmeTransportWsServer({ server: webserver })
      });
      fmServer.on("action", function(areq, ares) {
        ares.success({ action: "data" });
        fmServer.actionRevelation({
          actionName: areq.actionName,
          actionData: { action: "data" },
          feedName: "SomeFeed",
          feedArgs: { feed: "args" },
          feedDeltas: [{ Operation: "Increment", Path: ["count"], Value: 1 }]
        });
      });
      fmServer.on("feedOpen", function(foreq, fores) {
        fores.success({ count: 0 });
      });
      fmServer.start();

      // webserver.on("connection", function(socket) {
      //   console.log("connection");
      //   socket.on("data", function(data) {
      //     console.log("data", data.toString("utf8"));
      //   });
      // });

      // webserver.on("request", function(req) {
      //   console.log("request", req.originalUrl);
      // });

      // webserver.on("upgrade", function() {
      //   console.log("UPGRADE");
      // });

      // var wsServer = new ws.Server({
      //   server: webserver
      // });
      // wsServer.on("listening", function() {});
      // wsServer.on("close", function() {});
      // wsServer.on("connection", function(socket) {
      //   console.log("New connection!");
      //   socket.on("message", function(msg) {
      //     console.log("Server received: " + msg);
      //     socket.send("hi");
      //   });
      //   socket.on("close", function(code, reason) {});
      // });
    },
    function(cb) {
      // If you're running in local mode then stop here
      if (!localMode) {
        cb();
      }
    },
    function(cb) {
      // Start Sauce Connect proxy if you aren't on Travis
      if (process.env.CI) {
        console.log("Running on Travis - no need to start Sauce Connect.");
        cb();
        return;
      }

      console.log("Starting Sauce Connect proxy...");
      sauceConnectLauncher(
        {
          tunnelIdentifier: sauceTunnelId,
          logFile: null,
          noSslBumpDomains: "all", // Needed to get WebSockets working: https://wiki.saucelabs.com/display/DOCS/Sauce+Connect+Proxy+and+SSL+Certificate+Bumping
          noProxyCaching: true, // required?????
          verbose: true
        },
        function(err, process) {
          if (err) {
            console.log("Failed to start Sauce Connect proxy.");
            cb(err);
          } else {
            console.log("Sauce Connect proxy started.");
            sauceConnectProcess = process;
            cb();
          }
        }
      );
    },
    function(cb) {
      // Call the Sauce REST API telling it to run the tests
      console.log("Calling Sauce REST API telling it to run the tests...");

      request(
        {
          url:
            "https://saucelabs.com/rest/v1/" +
            process.env.SAUCE_USERNAME +
            "/js-tests",
          method: "POST",
          auth: {
            username: process.env.SAUCE_USERNAME,
            password: process.env.SAUCE_ACCESS_KEY
          },
          json: true,
          body: {
            url: "http://testinghost.com:" + port,
            framework: "custom",
            platforms: saucePlatforms,
            "tunnel-identifier": sauceTunnelId,
            // prerun: {
            //   executable:
            //     "https://raw.githubusercontent.com/aarong/feedme-transport-ws/master/tests/prerun.windows.cmd",
            //   background: false
            // },
            extendedDebugging: true // Works?
          }
        },
        function(err, response) {
          if (err) {
            console.log("Request failed.");
            cb(err);
          } else if (response.statusCode !== 200) {
            console.log("Sauce API returned an error.");
            cb(response.body); // Use body as error (printed)
          } else {
            console.log("API call executed successfully.");
            sauceTests = response.body;
            cb();
          }
        }
      );
    },
    function(cb) {
      // Poll Sauce for the test results
      console.log("Polling Sauce for the test results...");

      var interval = setInterval(function() {
        console.log("Calling Sauce REST API to check test status...");
        request(
          {
            url:
              "https://saucelabs.com/rest/v1/" +
              process.env.SAUCE_USERNAME +
              "/js-tests/status",
            method: "POST",
            auth: {
              username: process.env.SAUCE_USERNAME,
              password: process.env.SAUCE_ACCESS_KEY
            },
            json: true,
            body: sauceTests // From the above API call
          },
          function(err, response) {
            if (err) {
              console.log("Request failed.");
              cb(err);
            } else if (response.statusCode !== 200) {
              console.log("Sauce API returned an error.");
              cb(response.body); // Use body as error (printed)
            } else if (!response.body.completed) {
              console.log(
                "Sauce API indicated tests not completed. Polling again..."
              );
              // No callback
            } else {
              sauceResults = response.body["js tests"];
              clearInterval(interval);
              cb();
            }
          }
        );
      }, pollInterval);
    },
    function(cb) {
      var allPassed = true;

      // Process and display the test results for each platform
      for (var i = 0; i < sauceResults.length; i++) {
        var platformUrl = sauceResults[i].url;
        var platformName = sauceResults[i].platform.join(":");
        var platformResult = sauceResults[i].result; // The window.global_test_results object

        // Note platformResult is null if custom data exceeds 64k
        // Note platformResult.total/passed/failed === 0 if there is a Javascript error (change this)

        // Did the platform pass?
        // Make sure tests are actually running (ie don't just check that none failed)
        var platformPassed =
          platformResult &&
          platformResult.failed === 0 &&
          platformResult.passed > 0;

        // Display the platform name and result
        if (platformPassed) {
          console.log("       " + platformName + " passed all tests");
        } else {
          console.log(
            "FAILED " +
              platformName +
              " passed " +
              (platformResult ? platformResult.passed : "???") +
              "/" +
              (platformResult ? platformResult.total : "???") +
              " tests"
          );
          console.log("       " + platformUrl);

          // Print failed tests
          if (platformResult && platformResult.tests) {
            for (var j = 0; j < platformResult.tests.length; j++) {
              var test = platformResult.tests[j];
              if (!test.result) {
                console.log("         Failing test: " + test.name);
                console.log("         Message: " + test.message);
              }
            }
          }
        }

        // Track whether all platforms passed
        if (!platformPassed) {
          allPassed = false;
        }

        console.log("");
      }

      // Return success/failure
      if (allPassed) {
        cb();
      } else {
        cb("One or more platforms failed one or more tests.");
      }
    }
  ],
  function(err) {
    // Perform any cleanup
    async.series(
      [
        function(cb) {
          if (sauceConnectProcess) {
            sauceConnectProcess.close(function() {
              console.log("Sauce Connect proxy stopped.");
              cb();
            });
          } else {
            cb();
          }
        },
        function(cb) {
          if (webserver) {
            webserver.close(function() {
              console.log("Local webserver stopped.");
              cb();
            });
          } else {
            cb();
          }
        }
      ],
      function() {
        // Ignore any cleanup errors

        if (err) {
          console.log("Finished with error:");
          console.log(err);
          process.exit(1); // Return failure
        } else {
          console.log("Tests passed on all platforms.");
          process.exit(0);
        }
      }
    );
  }
);
