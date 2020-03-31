var express = require("express");
var url = require("url");
var feedmeServerCore = require("feedme-server-core");
var _ = require("lodash");
var feedmeTransportWsServer = require("../../build/server");

/*

Server for browser tests.

An Express web server delivers static content, including tests.

A Feedme API (the "controller") allows the browser to create and interact with
WebSocket, transport, and Feedme servers.

CORS does not restrict connections to WebSocket server hosts, so each server is
created on a separate port and is identified by its port number.

Feedme Controller Actions

  CreateWsServer
    Args: {}
    Returns: { Port }
  CreateTransportServer
    Args: {}
    Returns: { Port }
  CreateFeedmeServer
    Args: {}
    Returns: { Port }
  
  InvokeWsMethod
    Args: { Port, Method, Arguments: [] }
    Returns: { ReturnValue }
  InvokeTransportMethod
    Args: { Port, Method, Arguments: [] }
    Returns: { ReturnValue }
  InvokeFeedmeMethod
    Args: { Port, Method, Arguments: [] }
    Returns: { ReturnValue }
  
  DestroyWsServer
    Args: { Port }
    Returns: {}
  DestroyTransportServer
    Args: { Port }
    Returns: {}
  DestroyFeedmeServer
    Args: { Port }
    Returns: {}

Feedme Controller Feeds
  WsEvents
    Args: { Port }
    Revealed actions: 
      WsEvent with action data { Name, Arguments: [] }
  TransportEvents
    Args: { Port }
    Revealed actions:
      TransportEvent with action data { Name, Arguments: [] }
  FeedmeEvents
    Args: { Port }
    Revealed actions:
      FeedmeEvent with action data { Name, Arguments: [] }	

*/

var proto = {};

// Asynchronous factory function that calls back a server object once listening
module.exports = function server(port, cb) {
  var server = Object.create(proto);

  server._nextPort = 4000;

  // Server instances - indexed by port
  server._transportServerInstances = {};

  // Set up the HTTP server and call back when listening
  var e = express();
  e.use("/", express.static(__dirname + "/webroot"));
  server._httpServer = e.listen(port, cb);

  // Start Feedme controller API
  server._fmControllerServer = feedmeServerCore({
    transport: feedmeTransportWsServer({
      server: server._httpServer
    })
  });
  server._fmControllerServer.on("action", function(areq, ares) {
    server._controllerActions[areq.actionName].bind(server)(areq, ares);
  });
  server._fmControllerServer.on("feedOpen", function(foreq, fores) {
    fores.success({}); // Permit any feed to be opened
  });
  server._fmControllerServer.start();
};

proto.close = function close(cb) {
  this._fmControllerServer.stop();
  this._httpServer.close(cb);
};

proto._controllerActions = {};

proto._controllerActions.CreateTransportServer = function(areq, ares) {
  // Create a new transport server
  var port = this._nextPort;
  var transportServer = feedmeTransportWsServer({
    port: port
  });
  this._nextPort += 1;
  this._transportServerInstances[port + ""] = transportServer;

  // When the transport server emits an event, reveal an action it on
  // the controller TransportEvents feed
  [
    "starting",
    "start",
    "stopping",
    "stop",
    "connect",
    "message",
    "disconnect"
  ].forEach(
    function(evt) {
      transportServer.on(
        evt,
        function() {
          var args = [];
          _.each(arguments, function(val, idx) {
            args.push(val.toString()); // Convert Errors to strings (everything else is a string already)
          });
          var actionData = { EventName: evt, Arguments: args };
          this._fmControllerServer.actionRevelation({
            feedName: "Events",
            feedArgs: { Port: port + "" },
            actionName: "Event",
            actionData: actionData,
            feedDeltas: []
          });
        }.bind(this)
      );
    }.bind(this)
  );

  // Return success to the browser
  ares.success({ Port: port });
};

proto._controllerActions.InvokeTransportMethod = function(areq, ares) {
  // Make sure the port reference is valid
  var transportServer = this._transportServerInstances[
    areq.actionArgs.Port + ""
  ];
  if (!transportServer) {
    ares.failure("INVALID_PORT", {});
    return;
  }

  // Make sure the method is valid
  var method = transportServer[areq.actionArgs.Method];
  if (!method) {
    ares.failure("INVALID_METHOD", {});
    return;
  }

  // Run the method and get the result
  var ret;
  try {
    ret = method.apply(transportServer, areq.Arguments);
  } catch (e) {
    ares.failure("ERROR_THROWN", { Error: e.toString() });
    return;
  }

  // Return the result to the client
  if (ret === undefined) {
    ares.success({}); // Can't serialize undefined
  } else {
    ares.success({ ReturnValue: ret });
  }
};

proto._controllerActions.DestroyTransportServer = function(areq, ares) {
  // Make sure the port reference is valid
  var transportServer = this._transportServerInstances[
    areq.actionArgs.Port + ""
  ];
  if (!transportServer) {
    ares.failure("INVALID_PORT", {});
    return;
  }

  // Remove transport server reference and listeners
  delete this._transportServerInstances[areq.actionArgs.Port + ""];
  transportServer.removeAllListeners();

  // Stop the server if necessary
  var state = transportServer.state();
  if (state === "starting") {
    transportServer.once("start", function() {
      transportServer.stop();
    });
  } else if (state === "started") {
    transportServer.stop();
  }

  // Return success
  ares.success({});
};
