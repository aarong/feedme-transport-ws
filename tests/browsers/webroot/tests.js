var dbg = function(msg) {
  console.log(msg);
};
dbg("Starting browser tests");

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

// Allow each test to take significant time, given latency (defaults to 5000)
jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000; // Per test

var PORT = 3000; // Port for controller Feedme API
var ROOT_URL = "ws://testinghost.com";
var RETRY_LIMIT = 8; // How many times to attempt each test

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

var wsServerProto = Emitter({});

var createWsServer = function(feedmeControllerClient) {
  dbg("Creating WebSocket server");

  var server = Object.create(wsServerProto);

  // Members
  server.port = null;
  server._feedmeControllerClient = feedmeControllerClient;
  server._eventFeed = null;

  return new Promise(function(resolve, reject) {
    // Create a WebSocket server port
    dbg("Running action CreateWsPort");
    feedmeControllerClient.action("CreateWsPort", {}, function(err, ad) {
      if (err) {
        reject(err);
      } else {
        dbg("WebSocket port created on " + ad.Port);
        server.port = ad.Port;
        resolve();
      }
    });
  }).then(function() {
    return new Promise(function(resolve, reject) {
      // Open the server event feed and emit on revelation
      dbg("Opening WsEvents feed for port " + server.port);
      var eventFeed = feedmeControllerClient.feed("WsEvents", {
        Port: server.port + ""
      });
      server._eventFeed = eventFeed;
      eventFeed.once("open", function() {
        eventFeed.removeAllListeners("close");
        resolve(server);
      });
      eventFeed.once("close", function(err) {
        eventFeed.removeAllListeners("open");
        reject(err);
      });
      eventFeed.on("action", function(an, ad) {
        dbg(
          "Event revealed on WsEvents feed for port " +
            server.port +
            ": " +
            ad.EventName
        );
        dbg(ad);
        var emitArgs = ad.Arguments.slice(); // copy
        // Prepend with testing server-assigned client id if present
        // Present for client event emissions
        if (ad.ClientId) {
          emitArgs.unshift(ad.ClientId);
        }
        emitArgs.unshift(ad.EventName);
        server.emit.apply(server, emitArgs);
      });
      eventFeed.desireOpen();
    });
  });
};

["close"].forEach(function(method) {
  // Route ws server method calls to the Feedme API
  wsServerProto[method] = function() {
    dbg("Received call to WebSocket server method " + method);
    var _this = this;
    var args = [];
    for (var i = 0; i < arguments.length; i++) {
      args.push(arguments[i]);
    }
    return new Promise(function(resolve, reject) {
      _this._feedmeControllerClient.action(
        "InvokeWsMethod",
        { Port: _this.port, Method: method.toLowerCase(), Arguments: args },
        function(err, ad) {
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

["Send", "Terminate", "Close"].forEach(function(method) {
  // Route ws server method calls to the Feedme API
  var methodName = "client" + method;
  wsServerProto[methodName] = function() {
    dbg("Received call to WebSocket server method " + method);
    // First argument is client id, then actual ws client method arguments
    var _this = this;
    var args = [];
    for (var i = 0; i < arguments.length; i++) {
      args.push(arguments[i]);
    }
    var clientId = args.shift();
    return new Promise(function(resolve, reject) {
      _this._feedmeControllerClient.action(
        "InvokeWsClientMethod",
        {
          ClientId: clientId,
          Port: _this.port,
          Method: method.toLowerCase(),
          Arguments: args
        },
        function(err, ad) {
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

wsServerProto.start = function() {
  // Create a WebSocket server
  dbg("Running action CreateWsServer");
  this._feedmeControllerClient.action(
    "CreateWsServer",
    { Port: this.port },
    function(err, ad) {
      // Do nothing - will fire a listening event
    }
  );
};

wsServerProto.destroy = function() {
  // Close the event feed and destroy the server (server will stop if not stopped)
  dbg("Destroying WebSocket server");
  var _this = this;
  return new Promise(function(resolve, reject) {
    _this._eventFeed.desireClosed();
    _this._feedmeControllerClient.action(
      "DestroyWsServer",
      { Port: _this.port },
      function(err, ad) {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });
};

var createWsServerListener = function(ws) {
  var evts = [
    "listening",
    "close",
    "error",
    "connection",
    "clientMessage",
    "clientClose",
    "clientError"
  ];
  var l = {};
  evts.forEach(function(evt) {
    l[evt] = jasmine.createSpy();
    ws.on(evt, l[evt]);
  });
  l.mockClear = function() {
    evts.forEach(function(evt) {
      l[evt].calls.reset();
    });
  };
  return l;
};

/*

Feedme controller API wrapper for transport servers.

*/

var transportServerProto = Emitter({});

var createTransportServer = function(feedmeControllerClient) {
  dbg("Creating transport server");

  var server = Object.create(transportServerProto);

  // Members
  server.port = null;
  server._feedmeControllerClient = feedmeControllerClient;
  server._eventFeed = null;

  return new Promise(function(resolve, reject) {
    // Create a transport server
    dbg("Running action CreateTransportServer");
    feedmeControllerClient.action("CreateTransportServer", {}, function(
      err,
      ad
    ) {
      if (err) {
        reject(err);
      } else {
        dbg("Transport server launched on port " + ad.Port);
        server.port = ad.Port;
        resolve();
      }
    });
  }).then(function() {
    return new Promise(function(resolve, reject) {
      // Open the server event feed and emit on revelation
      dbg("Opening TransportEvents feed for port " + server.port);
      var eventFeed = feedmeControllerClient.feed("TransportEvents", {
        Port: server.port + ""
      });
      server._eventFeed = eventFeed;
      eventFeed.once("open", function() {
        eventFeed.removeAllListeners("close");
        resolve(server); // Return the server
      });
      eventFeed.once("close", function(err) {
        eventFeed.removeAllListeners("open");
        reject(err);
      });
      eventFeed.on("action", function(an, ad) {
        dbg(
          "Event revealed on TransportEvents feed for port " +
            server.port +
            ": " +
            ad.EventName
        );
        dbg(ad);
        var emitArgs = ad.Arguments.slice(); // copy
        emitArgs.unshift(ad.EventName);
        server.emit.apply(server, emitArgs);
      });
      eventFeed.desireOpen();
    });
  });
};

["state", "start", "stop", "send", "disconnect"].forEach(function(method) {
  // Route transportServer method calls to the Feedme API
  transportServerProto[method] = function() {
    dbg("Received call to transport server method " + method);
    var _this = this;
    var args = [];
    for (var i = 0; i < arguments.length; i++) {
      args.push(arguments[i]);
    }
    return new Promise(function(resolve, reject) {
      _this._feedmeControllerClient.action(
        "InvokeTransportMethod",
        { Port: _this.port, Method: method, Arguments: args },
        function(err, ad) {
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

transportServerProto.destroy = function() {
  dbg("Destroying WebSocket server");

  // Close the event feed and destroy the server (server will stop if not stopped)
  var _this = this;
  return new Promise(function(resolve, reject) {
    _this._eventFeed.desireClosed();
    _this._feedmeControllerClient.action(
      "DestroyTransportServer",
      { Port: _this.port },
      function(err, ad) {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });
};

var createTransportServerListener = function(ts) {
  var evts = [
    "starting",
    "start",
    "stopping",
    "stop",
    "connect",
    "message",
    "disconnect"
  ];
  var l = {};
  evts.forEach(function(evt) {
    l[evt] = jasmine.createSpy();
    ts.on(evt, l[evt]);
  });
  l.mockClear = function() {
    evts.forEach(function(evt) {
      l[evt].calls.reset();
    });
  };
  return l;
};

/*

Wrapper to retry failed tests (almost always a temporary conenctivity issue).

Accepts a function that returns a promise and returns a function that
returns a promise.

On failure, how do you ensure proper clean-up? Maybe don't worry about it too much -- very few tests fail
*/

var retry = function(testPromiseGenerator) {
  return function() {
    return new Promise(function(resolve, reject) {
      var attempts = 0;

      // Fucntion to run one attempt - recursive
      var attempt = function() {
        attempts += 1;
        testPromiseGenerator()
          .then(function() {
            // Test passed
            resolve();
          })
          .catch(function(err) {
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
  };
};

/*

Feedme controller client functions. You can't put these in beforeEach/afterEach
because they need to be within individual test retry wrappers -- if they fail,
they are retried.

*/

var connectControllerClient = function() {
  return new Promise(function(resolve, reject) {
    dbg("Connecting controller client");
    var client = feedmeClient({
      transport: feedmeTransportWsClient(ROOT_URL + ":" + PORT)
    });
    client.once("connect", function() {
      client.removeAllListeners("disconnect");
      resolve(client);
    });
    client.once("disconnect", function(err) {
      client.removeAllListeners("connect");
      reject(err);
    });
    client.connect();
  });
};

var disconnectControllerClient = function(fmClient) {
  return new Promise(function(resolve, reject) {
    dbg("Disconnecting controller client");
    fmClient.removeAllListeners();
    fmClient.once("disconnect", function() {
      resolve();
    });
    fmClient.disconnect();
  });
};

/*

Tests

*/

describe("Browser tests", function() {
  var test = function() {
    it(
      "should work using the JS adapter",
      retry(function() {
        return new Promise(function(masterResolve, masterReject) {
          var feedmeControllerClient;
          var wsServer;
          var transportClient;
          var wsServerListener;
          connectControllerClient()
            .then(function(c) {
              feedmeControllerClient = c;
              feedmeControllerClient.on("disconnect", function() {
                masterReject();
              });
              return createWsServer(feedmeControllerClient);
            })
            .then(function(s) {
              return new Promise(function(resolve, reject) {
                wsServer = s;
                wsServer.start();
                wsServer.once("listening", resolve);
                wsServer.on("close", function(err) {
                  masterReject(err);
                });
              });
            })
            .then(function() {
              return new Promise(function(resolve, reject) {
                // Connect a transport client
                transportClient = feedmeTransportWsClient(
                  ROOT_URL + ":" + wsServer.port
                );
                transportClient.connect();
                wsServer.once("connection", function() {
                  resolve();
                });
                transportClient.on("disconnect", function(err) {
                  masterReject(err);
                });
              });
            })
            .then(function() {
              return new Promise(function(resolve, reject) {
                // Make sure the client is connected
                if (transportClient.state() === "connected") {
                  resolve();
                } else {
                  transportClient.once("connect", function() {
                    transportClient.removeAllListeners("disconnect");
                    resolve();
                  });
                  transportClient.once("disconnect", function(err) {
                    transportClient.removeAllListeners("connect");
                    reject(err);
                  });
                }
              });
            })
            .then(function() {
              return new Promise(function(resolve, reject) {
                wsServer.on("clientMessage", function() {
                  dbg("got client message");
                });
                transportClient.send("hi"); // Not a promise
                wsServer.once("clientMessage", function() {
                  resolve();
                });
              });
            })
            .then(function() {
              transportClient.removeAllListeners();
              return new Promise(function(resolve, reject) {
                transportClient.once("disconnect", function() {
                  resolve();
                });
                transportClient.disconnect();
              });
            })
            .then(function() {
              return new Promise(function(resolve, reject) {
                // Destroy the server
                wsServer.removeAllListeners();
                feedmeControllerClient.action(
                  "DestroyWsServer",
                  { Port: wsServer.port },
                  function(err, ad) {
                    if (err) {
                      reject(err);
                    } else {
                      resolve();
                    }
                  }
                );
              });
            })
            .then(function() {
              return disconnectControllerClient(feedmeControllerClient);
            })
            .then(function() {
              expect(1).toBe(1);
              masterResolve();
            })
            .catch(function(err) {
              masterReject(err);
            });
        });
      })
    );
  };

  for (var i = 0; i < 50; i++) {
    describe("Iteration " + i, test);
  }
});
