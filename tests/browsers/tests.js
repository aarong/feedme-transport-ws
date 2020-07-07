import emitter from "component-emitter";

const dbg = function dbg(msg) {
  console.log(msg); // eslint-disable-line no-console
};
dbg("Starting browser tests");

// Included using <script> tags in index.html
/* global feedmeClient, feedmeTransportWsClient */

/*

Browser integration functional tests. Tests the browser client against
(1) a raw WebSocket server, (2) the transport server, and (3) a Feedme server.

Check:

  - Errors and return values
  - State functions - transport.state()
  - Client transport events
  - Server events

Don't worry about testing invalid arguments (done in unit tests) or that return
values are empty (only state() returns a value and it's checked everywhere).

The Feedme controller client connection is re-established for each tests, as
sharing across tests was causing failures even for a small number of tests.
  -- TRY AGAIN

It's crucial to properly close any open WebSocket connections at the end
of each test, otherwise many tests will fail.

Sauce seems to limit total test duration to around 5-6 minutes by capping
maxDuration. So you're limited to a maximum of around 150 tests overall,
unless you want to build the infrastructure to break them into smaller suites.

Around 1% of tests tend to fail due to connectivity issues, resulting in the
test timing out or DISCONNECT/TIMEOUT errors. So all tests are retried several
times on failure.

          // You need masterResolve/reject so that disconnect events can
          // fail the tests at any time - can't reject a promise once resolved
          // Otherwise tests hang if the connection is broken --

// Connect to the controller Feedme API before starting each test
// Keeping the controller connected between tests caused problems on browsers
*/

console.log("STARTING TESTS");
console.log(feedmeTransportWsClient);
console.log(feedmeClient);

// Allow each test to take significant time, given latency (defaults to 5000)
jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000; // Per test

const PORT = 3000; // Port for controller Feedme API
const ROOT_URL = "ws://testinghost.com";
const RETRY_LIMIT = 10; // How many times to attempt each test

// var delay = function(ms) {
//   return function() {
//     return new Promise(function(resolve, reject) {
//       setTimeout(function() {
//         resolve();
//       }, ms);
//     });
//   };
// };

/*

Feedme controller API wrapper for WebSocket servers.

*/

const wsServerProto = emitter({});

const createWsServer = function createWsServer(feedmeControllerClient) {
  dbg("Creating WebSocket server");

  const server = Object.create(wsServerProto);

  // Members
  server.port = null;
  server._feedmeControllerClient = feedmeControllerClient;
  server._eventFeed = null;

  return new Promise((resolve, reject) => {
    // Create a WebSocket server port
    dbg("Running action CreateWsPort");
    feedmeControllerClient.action("CreateWsPort", {}, (err, ad) => {
      if (err) {
        reject(err);
      } else {
        dbg(`WebSocket port created on ${ad.Port}`);
        server.port = ad.Port;
        resolve();
      }
    });
  }).then(
    () =>
      new Promise((resolve, reject) => {
        // Open the server event feed and emit on revelation
        dbg(`Opening WsEvents feed for port ${server.port}`);
        const eventFeed = feedmeControllerClient.feed("WsEvents", {
          Port: `${server.port}`
        });
        server._eventFeed = eventFeed;
        eventFeed.once("open", () => {
          eventFeed.removeAllListeners("close");
          resolve(server);
        });
        eventFeed.once("close", err => {
          eventFeed.removeAllListeners("open");
          reject(err);
        });
        eventFeed.on("action", (an, ad) => {
          dbg(
            `Event revealed on WsEvents feed for port ${server.port}: ${ad.EventName}`
          );
          dbg(ad);
          const emitArgs = ad.Arguments.slice(); // copy
          // Prepend with testing server-assigned client id if present
          // Present for client event emissions
          if (ad.ClientId) {
            emitArgs.unshift(ad.ClientId);
          }
          emitArgs.unshift(ad.EventName);
          server.emit(...emitArgs);
        });
        eventFeed.desireOpen();
      })
  );
};

["close"].forEach(method => {
  // Route ws server method calls to the Feedme API
  wsServerProto[method] = (...args2) => {
    dbg(`Received call to WebSocket server method ${method}`);
    const _this = this;
    const args = [];
    for (let i = 0; i < args2.length; i += 1) {
      args.push(args2[i]);
    }
    return new Promise((resolve, reject) => {
      _this._feedmeControllerClient.action(
        "InvokeWsMethod",
        { Port: _this.port, Method: method.toLowerCase(), Arguments: args },
        (err, ad) => {
          if (err) {
            reject(err);
          } else {
            resolve(ad.ReturnValue);
          }
        }
      );
    });
  };
});

["Send", "Terminate", "Close"].forEach(method => {
  // Route ws server method calls to the Feedme API
  const methodName = `client${method}`;
  wsServerProto[methodName] = (...args2) => {
    dbg(`Received call to WebSocket server method ${method}`);
    // First argument is client id, then actual ws client method arguments
    const _this = this;
    const args = [];
    for (let i = 0; i < args2.length; i += 1) {
      args.push(args2[i]);
    }
    const clientId = args.shift();
    return new Promise((resolve, reject) => {
      _this._feedmeControllerClient.action(
        "InvokeWsClientMethod",
        {
          ClientId: clientId,
          Port: _this.port,
          Method: method.toLowerCase(),
          Arguments: args
        },
        (err, ad) => {
          if (err) {
            reject(err);
          } else {
            resolve(ad.ReturnValue);
          }
        }
      );
    });
  };
});

wsServerProto.start = function start() {
  // Create a WebSocket server
  dbg("Running action CreateWsServer");
  this._feedmeControllerClient.action(
    "CreateWsServer",
    { Port: this.port },
    () => {
      // Do nothing - will fire a listening event
    }
  );
};

wsServerProto.destroy = function destroy() {
  // Close the event feed and destroy the server (server will stop if not stopped)
  dbg("Destroying WebSocket server");
  const _this = this;
  return new Promise((resolve, reject) => {
    _this._eventFeed.desireClosed();
    _this._feedmeControllerClient.action(
      "DestroyWsServer",
      { Port: _this.port },
      err => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });
};

// const createWsServerListener = function createWsServerListener(ws) {
//   const evts = [
//     "listening",
//     "close",
//     "error",
//     "connection",
//     "clientMessage",
//     "clientClose",
//     "clientError"
//   ];
//   const l = {};
//   evts.forEach(evt => {
//     l[evt] = jasmine.createSpy();
//     ws.on(evt, l[evt]);
//   });
//   l.mockClear = () => {
//     evts.forEach(evt => {
//       l[evt].calls.reset();
//     });
//   };
//   return l;
// };

/*

Feedme controller API wrapper for transport servers.

*/

const transportServerProto = emitter({});

// const createTransportServer = function createTransportServer(
//   feedmeControllerClient
// ) {
//   dbg("Creating transport server");

//   const server = Object.create(transportServerProto);

//   // Members
//   server.port = null;
//   server._feedmeControllerClient = feedmeControllerClient;
//   server._eventFeed = null;

//   return new Promise((resolve, reject) => {
//     // Create a transport server
//     dbg("Running action CreateTransportServer");
//     feedmeControllerClient.action("CreateTransportServer", {}, (err, ad) => {
//       if (err) {
//         reject(err);
//       } else {
//         dbg(`Transport server launched on port ${ad.Port}`);
//         server.port = ad.Port;
//         resolve();
//       }
//     });
//   }).then(
//     () =>
//       new Promise((resolve, reject) => {
//         // Open the server event feed and emit on revelation
//         dbg(`Opening TransportEvents feed for port ${server.port}`);
//         const eventFeed = feedmeControllerClient.feed("TransportEvents", {
//           Port: `${server.port}`
//         });
//         server._eventFeed = eventFeed;
//         eventFeed.once("open", () => {
//           eventFeed.removeAllListeners("close");
//           resolve(server); // Return the server
//         });
//         eventFeed.once("close", err => {
//           eventFeed.removeAllListeners("open");
//           reject(err);
//         });
//         eventFeed.on("action", (an, ad) => {
//           dbg(
//             `Event revealed on TransportEvents feed for port ${server.port}: ${ad.EventName}`
//           );
//           dbg(ad);
//           const emitArgs = ad.Arguments.slice(); // copy
//           emitArgs.unshift(ad.EventName);
//           server.emit(...emitArgs);
//         });
//         eventFeed.desireOpen();
//       })
//   );
// };

["state", "start", "stop", "send", "disconnect"].forEach(method => {
  // Route transportServer method calls to the Feedme API
  transportServerProto[method] = (...args2) => {
    dbg(`Received call to transport server method ${method}`);
    const _this = this;
    const args = [];
    for (let i = 0; i < args2.length; i += 1) {
      args.push(args2[i]);
    }
    return new Promise((resolve, reject) => {
      _this._feedmeControllerClient.action(
        "InvokeTransportMethod",
        { Port: _this.port, Method: method, Arguments: args },
        (err, ad) => {
          if (err) {
            reject(err);
          } else {
            resolve(ad.ReturnValue);
          }
        }
      );
    });
  };
});

transportServerProto.destroy = function destroy() {
  dbg("Destroying WebSocket server");

  // Close the event feed and destroy the server (server will stop if not stopped)
  const _this = this;
  return new Promise((resolve, reject) => {
    _this._eventFeed.desireClosed();
    _this._feedmeControllerClient.action(
      "DestroyTransportServer",
      { Port: _this.port },
      err => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });
};

// const createTransportServerListener = function createTransportServerListener(
//   ts
// ) {
//   const evts = [
//     "starting",
//     "start",
//     "stopping",
//     "stop",
//     "connect",
//     "message",
//     "disconnect"
//   ];
//   const l = {};
//   evts.forEach(evt => {
//     l[evt] = jasmine.createSpy();
//     ts.on(evt, l[evt]);
//   });
//   l.mockClear = () => {
//     evts.forEach(evt => {
//       l[evt].calls.reset();
//     });
//   };
//   return l;
// };

/*

Wrapper to retry failed tests (almost always a temporary conenctivity issue).

Accepts a function that returns a promise and returns a function that
returns a promise.

On failure, how do you ensure proper clean-up? Maybe don't worry about it too much -- very few tests fail
*/

const retry = testPromiseGenerator => () =>
  new Promise((resolve, reject) => {
    let attempts = 0;

    // Fucntion to run one attempt - recursive
    const attempt = () => {
      attempts += 1;
      testPromiseGenerator()
        .then(() => {
          // Test passed
          resolve();
        })
        .catch(err => {
          // Attempt failed - retry or fail the test
          if (attempts < RETRY_LIMIT) {
            attempt();
          } else {
            reject(err); // Only rejects with the latest error
          }
        });
    };

    // Start attempt
    attempt();
  });

/*

Feedme controller client functions. You can't put these in beforeEach/afterEach
because they need to be within individual test retry wrappers -- if they fail,
they are retried.

*/

const connectControllerClient = () =>
  new Promise((resolve, reject) => {
    dbg("Connecting controller client");
    const client = feedmeClient({
      transport: feedmeTransportWsClient(`${ROOT_URL}:${PORT}`)
    });
    client.once("connect", () => {
      client.removeAllListeners("disconnect");
      resolve(client);
    });
    client.once("disconnect", err => {
      client.removeAllListeners("connect");
      reject(err);
    });
    client.connect();
  });

const disconnectControllerClient = fmClient =>
  new Promise(resolve => {
    dbg("Disconnecting controller client");
    fmClient.removeAllListeners();
    fmClient.once("disconnect", () => {
      resolve();
    });
    fmClient.disconnect();
  });

/*

Tests

*/

let testNum = -"";

describe("Browser tests", () => {
  const test = () => {
    it(
      "should work using the JS adapter",
      retry(
        () =>
          new Promise((masterResolve, masterReject) => {
            let feedmeControllerClient;
            let wsServer;
            let transportClient;
            // let wsServerListener;
            connectControllerClient()
              .then(c => {
                feedmeControllerClient = c;
                feedmeControllerClient.on("disconnect", () => {
                  masterReject();
                });
                return createWsServer(feedmeControllerClient);
              })
              .then(
                s =>
                  new Promise(resolve => {
                    wsServer = s;
                    wsServer.start();
                    wsServer.once("listening", resolve);
                    wsServer.on("close", err => {
                      masterReject(err);
                    });
                  })
              )
              .then(
                () =>
                  new Promise(resolve => {
                    // Connect a transport client
                    transportClient = feedmeTransportWsClient(
                      `${ROOT_URL}:${wsServer.port}`
                    );
                    transportClient.connect();
                    wsServer.once("connection", () => {
                      resolve();
                    });
                    transportClient.on("disconnect", err => {
                      masterReject(err);
                    });
                  })
              )
              .then(
                () =>
                  new Promise((resolve, reject) => {
                    // Make sure the client is connected
                    if (transportClient.state() === "connected") {
                      resolve();
                    } else {
                      transportClient.once("connect", () => {
                        transportClient.removeAllListeners("disconnect");
                        resolve();
                      });
                      transportClient.once("disconnect", err => {
                        transportClient.removeAllListeners("connect");
                        reject(err);
                      });
                    }
                  })
              )
              .then(
                () =>
                  new Promise(resolve => {
                    wsServer.on("clientMessage", () => {
                      dbg("got client message");
                    });
                    transportClient.send("hi"); // Not a promise
                    wsServer.once("clientMessage", () => {
                      resolve();
                    });
                  })
              )
              .then(() => {
                transportClient.removeAllListeners();
                return new Promise(resolve => {
                  transportClient.once("disconnect", () => {
                    resolve();
                  });
                  transportClient.disconnect();
                });
              })
              .then(
                () =>
                  new Promise((resolve, reject) => {
                    // Destroy the server
                    wsServer.removeAllListeners();
                    feedmeControllerClient.action(
                      "DestroyWsServer",
                      { Port: wsServer.port },
                      err => {
                        if (err) {
                          reject(err);
                        } else {
                          resolve();
                        }
                      }
                    );
                  })
              )
              .then(() => disconnectControllerClient(feedmeControllerClient))
              .then(
                () =>
                  // Add a wait every 50 tests
                  new Promise(resolve => {
                    testNum += 1;
                    if (testNum % 50 === 0) {
                      setTimeout(resolve, 10000);
                    } else {
                      resolve();
                    }
                  })
              )
              .then(() => {
                expect(1).toBe(1);
                masterResolve();
              })
              .catch(err => {
                masterReject(err);
              });
          })
      )
    );
  };

  for (let i = 0; i < 5; i += 1) {
    describe(`Iteration ${i}`, test);
  }
});
