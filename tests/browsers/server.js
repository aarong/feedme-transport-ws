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

Path structure:

  /feedme/controller - Feedme Controller API
  /feedme/ws/id - A WebSocket server instance
  /feedme/transport/id - A transport server instance
  /feedme/feedme/id - A Feedme server instance

Feedme Controller Actions

  CreateWsServer
    Args: {}
    Returns: { WsServerId }
  CreateTransportServer
    Args: {}
    Returns: { TransportServerId }
  CreateFeedmeServer
    Args: {}
    Returns: { FeedmeServerId }
  
  InvokeWsMethod
    Args: { WsServerId, Method, Arguments: [] }
    Returns: { ReturnValue }
  InvokeTransportMethod
    Args: { TransportServerId, Method, Arguments: [] }
    Returns: { ReturnValue }
  InvokeFeedmeMethod
    Args: { FeedmeServerId, Method, Arguments: [] }
    Returns: { ReturnValue }
  
  DestroyWsServer
    Args: { WsServerId }
    Returns: {}
  DestroyTransportServer
    Args: { TransportServerId }
    Returns: {}
  DestroyFeedmeServer
    Args: { FeedmeServerId }
    Returns: {}

Feedme Controller Feeds
  WsEvents
    Args: { WsServerId }
    Revealed actions: 
      WsEvent with action data { Name, Arguments: [] }
  TransportEvents
    Args: { TransportServerId }
    Revealed actions:
      TransportEvent with action data { Name, Arguments: [] }
  FeedmeEvents
    Args: { FeedmeServerId }
    Revealed actions:
      FeedmeEvent with action data { Name, Arguments: [] }	

*/

var proto = {};

// Asynchronous factory function that calls back a server object once listening
module.exports = function server(port, cb) {
  var server = Object.create(proto);

  server._nextPort = 4000;

  // Server instances - indexed by port
  server._trasportServerInstances = {};

  // Set up the HTTP server
  server._express = express();
  server._express.use("/", express.static(__dirname + "/webroot"));

  // Start listening and call back
  server._httpServer = server._express.listen(port, cb);

  // Start Feedme controller API
  server._fmControllerServer = feedmeServerCore({
    transport: feedmeTransportWsServer({
      server: server._httpServer
      //  noServer: true
    })
  });
  server._fmControllerServer.on("action", function(areq, ares) {
    server._controllerActions[areq.actionName].bind(server)(areq, ares);
  });
  server._fmControllerServer.on("feedOpen", function(foreq, fores) {
    fores.success({});
  });
  server._fmControllerServer.start();

  // Route WebSocket upgrades to the appropriate server instance
  // server._httpServer.on("upgrade", function(request, socket, head) {
  //   var pathname = url.parse(request.url).pathname;
  //   if (pathname === "/feedme/controller") {
  //     server._fmControllerTransport.handleUpgrade(request, socket, head);
  //   } else if (false) {
  //     // Need to check path structure and that the instance server exists
  //   } else {
  //     socket.destroy();
  //   }
  // });
};

proto.close = function close(cb) {
  this._httpServer.close(cb);
  this._fmControllerServer.stop();
};

proto._controllerActions = {};

proto._controllerActions.CreateTransportServer = function(areq, ares) {
  // Create a new transport server
  var port = this._nextPort;
  var transportServer = feedmeTransportWsServer({
    port: port
    //noServer: true
  });
  this._nextPort += 1;

  console.log(port);

  // // Generate an unused instance id
  // var instanceId;
  // do {
  //   instanceId = parseInt(Math.random() * 10000) + "";
  // } while (this._fmInstanceServers[instanceId]);

  // When the transport server emits an event, reveal an action it on the TransportEvents
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
          var actionData = { EventName: evt };
          _.each(arguments, function(val, idx) {
            actionData["Arg" + idx] = val;
          });
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

  setTimeout(function() {
    transportServer.start();
  }, 2000);

  this._trasportServerInstances[port + ""] = transportServer;

  ares.success({ Port: port });
};

proto._controllerActions.InvokeTransportMethod = function(areq, ares) {};

proto._controllerActions.DestroyTransportServer = function(areq, ares) {};
