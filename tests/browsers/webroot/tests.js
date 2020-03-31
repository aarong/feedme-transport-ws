/*

Browser functional tests.

*/

var PORT = 3000; // Port for controller - tests create servers with unique ports as required
var ROOT_URL = "ws://testinghost.com";
var LATENCY = 200; // Assumed latency to the server

// Wrap the Feedme controller API for transport servers
var transportServerProto = Emitter({});
var createTransportServer = function(feedmeControllerClient) {
  var server = Object.create(transportServerProto);

  // Internal members
  server._feedmeControllerClient = feedmeControllerClient;
  server._port = null;
  server._eventFeed = null;

  return new Promise(function(resolve, reject) {
    // Create a transport server
    server._feedmeControllerClient.action("CreateTransportServer", {}, function(
      err,
      ad
    ) {
      if (err) {
        reject(err);
      } else {
        server._port = ad.Port;
        resolve();
      }
    });
  }).then(function() {
    return new Promise(function(resolve, reject) {
      // Open the transport server event feed and emit on revelation
      server._eventFeed = server._feedmeControllerClient.feed("Events", {
        Port: server._port + ""
      });
      server._eventFeed.once("open", function() {
        server._eventFeed.removeAllListeners("close");
        resolve(server); // Return the server
      });
      server._eventFeed.once("close", function(err) {
        server._eventFeed.removeAllListeners("open");
        reject(err);
      });
      server._eventFeed.on("action", function(an, ad) {
        var emitArgs = ad.Arguments;
        emitArgs.unshift(ad.EventName);
        server.emit.apply(server, emitArgs);
      });
      server._eventFeed.desireOpen();
    });
  });
};

// Route transportServer method calls to the Feedme API
["state", "start", "stop", "send", "disconnect"].forEach(function(method) {
  transportServerProto[method] = function() {
    var _this = this;
    var args = [];
    for (var i = 0; i < arguments.length; i++) {
      args.push(arguments[i]);
    }
    return new Promise(function(resolve, reject) {
      _this._feedmeControllerClient.action(
        "InvokeTransportMethod",
        { Port: _this._port, Method: method, Arguments: args },
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
  // Close the event feed and destroy the server (server will stop if not stopped)
  var _this = this;
  return new Promise(function(resolve, reject) {
    _this._eventFeed.desireClosed();
    _this._feedmeControllerClient.action(
      "DestroyTransportServer",
      { Port: _this._port },
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
  var l = {};
  [
    "starting",
    "start",
    "stopping",
    "stop",
    "connect",
    "message",
    "disconnect"
  ].forEach(function(evt) {
    l[evt] = jasmine.createSpy();
    ts.on(evt, l[evt]);
  });
  // Needs mock clear option
  return l;
};

describe("Server test", function() {
  // Connect to the controller Feedme API before starting tests and disconnect when done
  var feedmeControllerClient;
  beforeAll(function() {
    return new Promise(function(resolve, reject) {
      feedmeControllerClient = feedmeClient({
        transport: feedmeTransportWsClient(ROOT_URL + ":" + PORT)
      });
      feedmeControllerClient.once("connect", function() {
        feedmeControllerClient.removeAllListeners("disconnect");
        resolve();
      });
      feedmeControllerClient.once("disconnect", function(err) {
        feedmeControllerClient.removeAllListeners("connect");
        reject(err);
      });
      feedmeControllerClient.connect();
    });
  });
  afterAll(function() {
    feedmeControllerClient.disconnect();
  });

  it("should do something", function() {
    var server;
    var listener;
    return createTransportServer(feedmeControllerClient) // Promise
      .then(function(s) {
        server = s;
        listener = createTransportServerListener(server);
        return server.start();
      })
      .then(function() {
        return new Promise(function(resolve, reject) {
          setTimeout(resolve, LATENCY);
        });
      })
      .then(function() {
        expect(listener.starting.calls.count()).toBe(1);
        expect(listener.starting.calls.argsFor(0).length).toBe(0);
        expect(listener.start.calls.count()).toBe(1);
        expect(listener.start.calls.argsFor(0).length).toBe(0);
        expect(listener.stopping.calls.count()).toBe(0);
        expect(listener.stop.calls.count()).toBe(0);
        expect(listener.connect.calls.count()).toBe(0);
        expect(listener.message.calls.count()).toBe(0);
        expect(listener.disconnect.calls.count()).toBe(0);
      })
      .then(function() {
        return server.destroy(); // Promise
      });
  });
});
