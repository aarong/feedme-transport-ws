var express = require("express");
var url = require("url");
var feedmeServerCore = require("feedme-server-core");
var _ = require("lodash");
var feedmeTransportWsServer = require("../../build/server");

/*

Server for browser tests.

An Express web server delivers static content, including tests.

The Controller Feedme API allows the browser to create WebSocket, transport, and
Feedme servers. The browser can then listen for their events, invoke methods on
them, and destroy them using the Controller API.

Path structure:

  /feedme/controller - Feedme Controller API
  /feedme/ws/id - A WebSocket server instance
  /feedme/transport/id - A transport server instance
  /feedme/feedme/id - A Feedme server instance

Feedme Controller API

Actions
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

Feeds
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

module.exports = function server(port, cb) {
  var server = Object.create(proto);

  server._fmInstanceServers = {}; // Indexed by instance server id

  // Start HTTP server
  var e = express();
  e.use("/", express.static(__dirname + "/webroot"));

  server._httpServer = e.listen(port, function(err) {
    if (err) {
      cb(err);
      return;
    }

    // Start Feedme controller server
    server._fmControllerTransport = feedmeTransportWsServer({
      noServer: true
    });
    server._fmControllerServer = feedmeServerCore({
      transport: server._fmControllerTransport
    });
    server._fmControllerServer.on("action", function(areq, ares) {
      if (areq.actionName === "CreateServer") {
        // Generate an unused instance id
        var instanceId;
        do {
          instanceId = parseInt(Math.random() * 10000) + "";
        } while (server._fmInstanceServers[instanceId]);

        // Reveal an Event action on the controller when transport emits an event
        var fmInstanceTransport = feedmeTransportWsServer({ noServer: true });
        [
          "starting",
          "start",
          "stopping",
          "stop",
          "connect",
          "message",
          "disconnect"
        ].forEach(function(evt) {
          fmInstanceTransport.on(evt, function() {
            var actionData = { EventName: evt };
            _.each(arguments, function(val, idx) {
              actionData["Arg" + idx] = val;
            });
            server._fmControllerServer.actionRevelation({
              feedName: "Events",
              feedArgs: { ServerId: instanceId },
              actionName: "Event",
              actionData: actionData,
              feedDeltas: []
            });
          });
        });

        setTimeout(function() {
          fmInstanceTransport.start();
        }, 2000);

        server._fmInstanceServers[instanceId] = fmInstanceTransport;

        ares.success({ ServerId: instanceId });
      } else {
        ares.failure("INVALID_ACTION", {});
      }
    });
    server._fmControllerServer.on("feedOpen", function(foreq, fores) {
      fores.success({ count: 0 });
    });
    server._fmControllerServer.once("start", cb);
    server._fmControllerServer.start();

    server._httpServer.on("upgrade", function(request, socket, head) {
      var pathname = url.parse(request.url).pathname;
      if (pathname === "/feedme/controller") {
        server._fmControllerTransport.handleUpgrade(request, socket, head);
      } else if (false) {
        // Need to check path structure and that the instance server exists
      } else {
        socket.destroy();
      }
    });
  });
};

proto.close = function close(cb) {
  this._httpServer.close(cb);
  this._fmServer.stop();
};
