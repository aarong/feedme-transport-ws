const copyFileSync = require("fs-copy-file-sync"); // Not in Node 6
const sauceConnectLauncher = require("sauce-connect-launcher");
const async = require("async");
const request = require("request");
const hostile = require("hostile");
const _ = require("lodash");
const childProcess = require("child_process");
const testingServer = require("./server");

/* eslint-disable no-console */

/*

Testing WebSockets on Sauce Labs

Due to the way that Sauce Connect Proxy works, in many browsers you can’t establish
WebSocket connections directly from the browser to localhost. To get around this,
you need to route another domain to 127.0.0.1 and have the browser access that domain.

This routing is done by adjusting the local hosts file. The Sauce Connect proxy
routes all VM browser connection requests to the PC running Sauce Connect,
which then looks up the domain in the hosts file and sees that it is routed to
localhost.

You can't use a prerun script to edit the VM hosts file, as that does not work
with the Sauce Connect proxy. So any developers running the Sauce tests need
to add an entry to their local hosts file. 

*/

// Determine mode
// sauce-automatic: launches Sauce Connect Proxy and a suite of testing VMs on Sauce
// sauce-live: launches Sauce Connect Proxy so that you log into Sauce and do a live test
// local: launches only the local web server, which can be accessed from a local browser
let mode = "sauce-automatic"; // default (for Travis)
if (process.argv.length >= 3) {
  if (
    _.includes(
      ["sauce-automatic", "sauce-live", "local"],
      process.argv[2].toLowerCase()
    )
  ) {
    mode = process.argv[2].toLowerCase();
  } else {
    throw new Error(
      "INVALID_ARGUMENT: Mode must be local, sauce-live, or sauce-automatic (default)."
    );
  }
}

// If the tests are to be run on Sauce, make sure the hosts file has the required entry
let hasHostsEntry = false;
if (mode !== "local") {
  const lines = hostile.get(false);
  lines.forEach(line => {
    const ip = line[0];
    const hosts = line[1].split(" "); // Travis routes multiple hosts to 127.0.0.1 delimited by spaces
    if (ip === "127.0.0.1" && _.includes(hosts, "testinghost.com")) {
      hasHostsEntry = true;
    }
  });
  if (!hasHostsEntry) {
    throw new Error(
      "NO_HOSTS_ENTRY: You need to route testinghost.com to 127.0.0.1 in your hosts file in order to run the Sauce tests."
    );
  }
}

// Require Sauce credentials if you're not running locally
if (
  mode !== "local" &&
  (!process.env.SAUCE_USERNAME || !process.env.SAUCE_ACCESS_KEY)
) {
  throw new Error(
    "NO_CREDENTIALS: The SAUCE_USERNAME or SAUCE_ACCESS_KEY environmental variable is missing."
  );
}

// Config
const port = 3000;
const sauceTunnelId =
  process.env.TRAVIS_JOB_NUMBER || "feedme-transport-ws-tunnel"; // Travis sets tunnel id to job number
const saucePollInterval = 10000;
const saucePlatforms = [
  // // Available Sauce platforms: https://saucelabs.com/platforms
  // // General approach is to tests earliest and latest browser versions available on all platforms

  // // If you include a bad platform-browser combination, Sauce never returns results even when
  // // the good ones are done, and does not return an error either (bad tests not listed on dashboard)

  // // REST API only supports desktop platforms, not mobile (confirmed with support)
  // // For mobile platforms you need to use Appium directly (see their platform
  // // configurator), or one of their testing frameworks:
  // // https://github.com/saucelabs-sample-test-frameworks

  // // WebSockets introduced in FireFox 11, but fails on 15 and below with 1006 error
  // ["Windows 10", "Firefox", "16"],

  // // In 56 and above the tests are shown in the VM to have completed
  // // successfully (no console errors) but the VM doesn't terminate and
  // // Sauce eventually kills the VM after 5-6 minutes
  // // Tests pass locally on recent Firefox version
  // ["Windows 10", "Firefox", "55"],

  // // In 28 and below tests don't even seem to launch (VM blank)
  // ["Windows 10", "Chrome", "29"],
  ["Windows 10", "Chrome", "latest"]

  // ["Windows 10", "MicrosoftEdge", "13"], // Earliest available version
  // ["Windows 10", "MicrosoftEdge", "latest"],

  // // IE 9 does not support Jasmine
  // // ["Windows 7", "Internet Explorer", "9"],

  // // IE 10 prevents more than six WebSocket connections from being established
  // // by one browser instance, apparently even sequentially
  // // ["Windows 8", "Internet Explorer", "10"],

  // ["Windows 10", "Internet Explorer", "11"],

  // // Same issue was Win 10 FF 56+ - tests seem to pass but don't return results
  // // ["macOS 10.14", "Safari", "latest"],
  // // ["macOS 10.14", "Firefox", "latest"],

  // ["macOS 10.14", "Chrome", "latest"],

  // /*

  // macOS 10.13

  // */

  // // 55 works - how early can I go on this? And all others?
  // // 56+ tests pass but don't return
  // ["macOS 10.13", "Firefox", "55"],

  // // Tests pass but don't return
  // //["macOS 10.13", "Firefox", "latest"],

  // ["macOS 10.13", "Chrome", "latest"],

  // // Safari tests all pass but don't return
  // // ["macOS 10.13", "Safari", "latest"],
  // // ["macOS 10.13", "Safari", "11"],

  // /*

  // macOS 10.12

  // */

  // // Safari tests pass but don't return
  // //["macOS 10.12", "Safari", "10"],

  // /*

  // Platforms macOS 10.10 and 10.11 report unsupported OS/browser/version combo

  // */

  // /*

  // Platform: LINUX

  // */

  // // Firefox 15 and below fail with 1006 error
  // ["Linux", "Firefox", "16"],
  // ["Linux", "Firefox", "latest"],

  // // Chrome 29 and below tests won't even start
  // ["Linux", "Chrome", "30"],
  // ["Linux", "Chrome", "latest"]
];

// Run the tests
let server;
let sauceConnectProcess;
let sauceTests;
let sauceResults;
async.series(
  [
    cb => {
      // Transpile the tests and drop in webroot
      console.log("Transpiling tests...");
      childProcess.exec(
        `babel "${__dirname}/tests.js" --out-file "${__dirname}/webroot/tests.js"`,
        cb
      );
    },
    cb => {
      // Set up the webroot with built browser.bundle.withmaps
      copyFileSync(
        `${__dirname}/../../build/browser.bundle.withmaps.js`,
        `${__dirname}/webroot/browser.bundle.withmaps.js`
      );
      copyFileSync(
        `${__dirname}/../../build/browser.bundle.withmaps.js.map`,
        `${__dirname}/webroot/browser.bundle.withmaps.js.map`
      );

      cb();
    },
    cb => {
      // Start the local server
      console.log("Starting local server to host the tests...");
      testingServer(port, (err, s) => {
        if (err) {
          console.log("Failed to start server.");
          cb(err);
        } else {
          server = s;
          console.log(`Local server started on http://localhost:${port}`);
          if (hasHostsEntry) {
            console.log(
              "Also available as http://testinghost.com:3000 via hosts file"
            );
          }
          cb();
        }
      });
    },
    cb => {
      // If you're running in local mode then stop here
      if (mode !== "local") {
        cb();
      }
    },
    cb => {
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
          verbose: true
        },
        (err, process) => {
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
    cb => {
      // If you're running in sauce-live mode then stop here
      if (mode !== "sauce-live") {
        cb();
      }
    },
    cb => {
      // Call the Sauce REST API telling it to run the tests
      console.log("Calling Sauce REST API telling it to run the tests...");

      request(
        {
          url: `https://saucelabs.com/rest/v1/${process.env.SAUCE_USERNAME}/js-tests`,
          method: "POST",
          auth: {
            username: process.env.SAUCE_USERNAME,
            password: process.env.SAUCE_ACCESS_KEY
          },
          json: true,
          body: {
            // url: "http://testinghost.com:" + port,
            url: `http://localhost:${port}/?throwFailures=true&oneFailurePerSpec=true`, // &failFast=true (stop tests on first fail)
            framework: "custom",
            platforms: saucePlatforms,
            "tunnel-identifier": sauceTunnelId,
            extendedDebugging: true, // Works?
            maxDuration: 1800
            // maxDuration: 1800 // seconds - DOES work (low fails), but capped at around 5-6 minutes by Sauce
          }
        },
        (err, response) => {
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
    cb => {
      // Poll Sauce for the test results
      console.log("Polling Sauce for the test results...");

      const interval = setInterval(() => {
        console.log("Calling Sauce REST API to check test status...");
        request(
          {
            url: `https://saucelabs.com/rest/v1/${process.env.SAUCE_USERNAME}/js-tests/status`,
            method: "POST",
            auth: {
              username: process.env.SAUCE_USERNAME,
              password: process.env.SAUCE_ACCESS_KEY
            },
            json: true,
            body: sauceTests // From the above API call
          },
          (err, response) => {
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
      }, saucePollInterval);
    },
    cb => {
      let allPassed = true;

      // Process and display the test results for each platform
      for (let i = 0; i < sauceResults.length; i += 1) {
        const platformUrl = sauceResults[i].url;
        const platformName = sauceResults[i].platform.join(":");
        const platformResult = sauceResults[i].result; // The window.global_test_results object

        // Note platformResult is null if custom data exceeds 64k
        // Note platformResult.total/passed/failed === 0 if there is a Javascript error (change this)

        // Did the platform pass?
        // Make sure tests are actually running (ie don't just check that none failed)
        const platformPassed =
          platformResult &&
          platformResult.failed === 0 &&
          platformResult.passed > 0;

        // Display the platform name and result
        if (platformPassed) {
          console.log(`${platformName} passed all tests`);
        } else {
          console.log(
            `FAILED ${platformName} passed ${
              platformResult ? platformResult.passed : "???"
            }/${platformResult ? platformResult.total : "???"} tests`
          );
          console.log(platformUrl);

          // Print failed tests
          if (platformResult && platformResult.tests) {
            for (let j = 0; j < platformResult.tests.length; j += 1) {
              const test = platformResult.tests[j];
              if (!test.result) {
                console.log(`Failing test: ${test.name}`);
                console.log(`Message: ${test.message}`);
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
  err => {
    // Perform any cleanup
    async.series(
      [
        cb => {
          if (sauceConnectProcess) {
            sauceConnectProcess.close(() => {
              console.log("Sauce Connect proxy stopped.");
              cb();
            });
          } else {
            cb();
          }
        },
        cb => {
          if (server) {
            server.close(() => {
              console.log("Local server stopped.");
              cb();
            });
          } else {
            cb();
          }
        }
      ],
      () => {
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
