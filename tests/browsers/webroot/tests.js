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

Don't worry about testing argument validity (done in unit tests) or that return
values are empty (only state() returns a value and it's checked everywhere).

Timeouts are used to account for latency.

*/

jasmine.DEFAULT_TIMEOUT_INTERVAL = 60000; // You have long-running tests -- REASONABLE??

var PORT = 3000; // Port for controller Feedme API
var ROOT_URL = "ws://testinghost.com";
var LATENCY = 500; // Assumed latency to the server

var delay = function(ms) {
  return function() {
    return new Promise(function(resolve, reject) {
      setTimeout(function() {
        resolve();
      }, ms);
    });
  };
};

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

Tests

*/

describe("Browser tests", function() {
  // Connect to the controller Feedme API before starting each test
  // Keeping the controller connected between tests caused problems on browsers
  var feedmeControllerClient;
  beforeEach(function() {
    return new Promise(function(resolve, reject) {
      feedmeControllerClient = feedmeClient({
        transport: feedmeTransportWsClient(ROOT_URL + ":" + PORT)
      });
      feedmeControllerClient.once("connect", function() {
        feedmeControllerClient.removeAllListeners("disconnect");
        resolve();
      });
      feedmeControllerClient.once("disconnect", function(err) {
        // This connection always seems to time out on the 6th attempt in IE 10
        // Is there some browser limitation? YES
        // https://stackoverflow.com/questions/15114279/websocket-on-ie10-giving-a-securityerror
        // Am I waiting for full disconnect everywhere? Worst case ditch IE 10
        feedmeControllerClient.removeAllListeners("connect");
        reject(err);
      });
      feedmeControllerClient.connect();
    });
  });
  afterEach(function() {
    return new Promise(function(resolve, reject) {
      feedmeControllerClient.once("disconnect", function() {
        resolve();
      });
      feedmeControllerClient.disconnect();
    });
  });

  var test = function() {
    it("should work using the JS adapter", function() {
      var wsServer;
      var transportClient;
      var wsServerListener;
      return createWsServer(feedmeControllerClient) // Promise
        .then(function(s) {
          console.log("outer");
          return new Promise(function(resolve, reject) {
            console.log("inner");
            wsServer = s;
            wsServer.start();
            wsServer.once("listening", resolve);
            // THIS was the problem for everything except IE 10!!!
            // So have an action to reserve a port, and then an action to initialize ws server
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
              transportClient.removeAllListeners("disconnect");
              resolve();
            });
            transportClient.once("disconnect", function(err) {
              // What if the disconnect is after server connection event?
              // You could add disconnect handlers to everything below?
              // And what if the feedmeControllerClient fails??
              // Build into server API? Another harness layer?
              reject(err);
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
          return new Promise(function(resolve, reject) {
            transportClient.once("disconnect", function() {
              resolve();
            });
            transportClient.disconnect();
          });
        })
        .then(function() {
          return new Promise(function(resolve, reject) {
            console.log(wsServer);
            // Destroy the server
            feedmeControllerClient.action(
              "DestroyWsServer",
              { Port: wsServer.port },
              function(err, ad) {
                if (err) {
                  reject(err);
                } else {
                  expect(1).toBe(1);
                  resolve();
                }
              }
            );
          });
        });
    });
  };

  for (var i = 0; i < 10; i++) {
    describe("Iteration " + i, test);
  }
});
