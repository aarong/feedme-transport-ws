var uuid = require("uuid");
var express = require("express");
var url = require("url");
var feedmeServerCore = require("feedme-server-core");
var _ = require("lodash");
var WebSocket = require("ws");
var jsonExpressible = require("json-expressible");
var debug = require("debug");
var feedmeTransportWsServer = require("../../build/server");

var dbg = debug("feedme-transport-ws:browser-test-server");

/*

Server for browser tests.

An Express web server delivers static content, including tests.

A Feedme API (the "controller") allows the browser to create and interact with
WebSocket, transport, and Feedme servers.

CORS does not restrict connections to WebSocket server hosts, so each server is
created on a separate port and is identified by its port number.

The browser is only tested against stand-alone WebSocket, transport, and Feedme
servers (i.e. no ws server/noServer configurations or any other ws options).
Testing various server configurations is out of scope -- the purpose is to
test the browser client. Server configurations are tested in the Node server tests.

The Feedme and transport server controllers are entirely analogous to one another, but
there are a few complications with the WebSocket server controller:

  1. The ws server begins listening immediately on initialization, so you need
  one action to first establish a port on which the client can listen for
  events, and then another action to actually initialize the server.

  2. The ws server represents clients as objects with their own methods so you need to:
      - Assign a client id to each connection an attach it to the connection event
      - Have an InvokeWsClientMethod action that enables invokation by client id
      - Reveal ws client events on WsEvents, but prepend the event name with "client"
        and attach the client id

Feedme Controller Actions

  CreateWsPort
    Args: {}
    Returns: { Port }
  CreateWsServer
    Args: { Port }
    Returns: {}
  CreateTransportServer
    Args: {}
    Returns: { Port }
  CreateFeedmeServer
    Args: {}
    Returns: { Port }
  
  InvokeWsMethod
    Args: { Port, Method, Arguments: [] }
    Returns: { ReturnValue }
  InvokeWsClientMethod
    Args: { Port, ClientId, Method, Arguments: [] }
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
      WsEvent with action data { Name, Arguments: [], and ClientId for connection and client events }
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
  dbg("Launching server");
  var server = Object.create(proto);

  // Internal members
  server._nextPort = 4000;
  server._wsServers = {}; // indexed by port
  server._wsServerClients = {}; // indexed by port and then client id
  server._transportServers = {}; // indexed by port

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
  dbg("Stopping server");
  this._fmControllerServer.stop();
  this._httpServer.close(cb);
};

// Unsafe ports on Chrome
// https://superuser.com/questions/188058/which-ports-are-considered-unsafe-by-chrome?rq=1
var unsafePorts = [
  1, // tcpmux
  7, // echo
  9, // discard
  11, // systat
  13, // daytime
  15, // netstat
  17, // qotd
  19, // chargen
  20, // ftp data
  21, // ftp access
  22, // ssh
  23, // telnet
  25, // smtp
  37, // time
  42, // name
  43, // nicname
  53, // domain
  77, // priv-rjs
  79, // finger
  87, // ttylink
  95, // supdup
  101, // hostriame
  102, // iso-tsap
  103, // gppitnp
  104, // acr-nema
  109, // pop2
  110, // pop3
  111, // sunrpc
  113, // auth
  115, // sftp
  117, // uucp-path
  119, // nntp
  123, // NTP
  135, // loc-srv /epmap
  139, // netbios
  143, // imap2
  179, // BGP
  389, // ldap
  427, // SLP (Also used by Apple Filing Protocol)
  465, // smtp+ssl
  512, // print / exec
  513, // login
  514, // shell
  515, // printer
  526, // tempo
  530, // courier
  531, // chat
  532, // netnews
  540, // uucp
  548, // AFP (Apple Filing Protocol)
  556, // remotefs
  563, // nntp+ssl
  587, // stmp?
  601, // ??
  636, // ldap+ssl
  993, // ldap+ssl
  995, // pop3+ssl
  2049, // nfs
  3659, // apple-sasl / PasswordServer
  4045, // lockd
  6000, // X11
  6665, // Alternate IRC [Apple addition]
  6666, // Alternate IRC [Apple addition]
  6667, // Standard IRC [Apple addition]
  6668, // Alternate IRC [Apple addition]
  6669, // Alternate IRC [Apple addition]
  6697 // IRC + TLS
];

proto._getNextPort = function() {
  var p;
  do {
    p = this._nextPort;
    this._nextPort += 1;
  } while (unsafePorts.indexOf(p) >= 0);
  return p;
};

proto._getJsonExpressible = function(a) {
  // Make things like Error and ws client objects JSON-expressible
  return jsonExpressible(a) ? a : a.toString();
};

proto._controllerActions = {};

// WebSocket server actions

proto._controllerActions.CreateWsPort = function(areq, ares) {
  dbg("Received CreateWsPort action request");

  var _this = this;

  // Reserve a new WebSocket port
  var port = this._getNextPort();
  this._wsServers[port + ""] = null;
  this._wsServerClients[port + ""] = {};

  // Return success to the browser
  ares.success({ Port: port });
};

proto._controllerActions.CreateWsServer = function(areq, ares) {
  dbg("Received CreateWsServer action request");

  var _this = this;

  // Ensure this port has been created and not yet used
  var port = areq.actionArgs.Port;
  if (this._wsServers[port + ""] !== null) {
    ares.error("INVALID_PORT", "Port not created or server already present.");
    return;
  }

  // Create a new WebSocket server on the specified port
  var wsServer = new WebSocket.Server({
    port: port
  });
  this._wsServers[port + ""] = wsServer;

  // Server connection events are handled separately because you need
  // to assign a client id, save the ws client reference, and reveal ws
  // client actions on WsEvents
  wsServer.on("connection", function(ws) {
    dbg("Observed Websocket server connection event");
    // Assign a client id
    var cid = uuid();
    _this._wsServerClients[port + ""][cid] = ws;

    // Listen for client events - no pong (controlled by the browser)
    ["Message", "Close", "Error"].forEach(function(evt) {
      ws.on(evt.toLowerCase(), function() {
        dbg("Observed Websocket server client " + evt.toLowerCase() + " event");
        var args = [];
        _.each(arguments, function(val) {
          args.push(_this._getJsonExpressible(val));
        });
        var actionData = {
          EventName: "client" + evt,
          ClientId: cid,
          Arguments: args
        };
        _this._fmControllerServer.actionRevelation({
          feedName: "WsEvents",
          feedArgs: { Port: port + "" },
          actionName: "Event",
          actionData: actionData,
          feedDeltas: []
        });
      });
    });

    // Stop listening for client events on socket close
    ws.on("close", function() {
      ws.removeAllListeners();
    });

    // Reveal
    var args = [];
    _.each(arguments, function(val) {
      args.push(_this._getJsonExpressible(val));
    });
    var actionData = {
      EventName: "connection",
      ClientId: cid,
      Arguments: args
    };
    _this._fmControllerServer.actionRevelation({
      feedName: "WsEvents",
      feedArgs: { Port: port + "" },
      actionName: "Event",
      actionData: actionData,
      feedDeltas: []
    });
  });

  // When the server emits any other event, reveal an action the controller WsEvents feed
  ["listening", "close", "error"].forEach(function(evt) {
    wsServer.on(evt, function() {
      dbg("Observed Websocket server " + evt + " event");
      // Reveal the event
      var args = [];
      _.each(arguments, function(val) {
        args.push(_this._getJsonExpressible(val));
      });
      var actionData = { EventName: evt, Arguments: args };
      _this._fmControllerServer.actionRevelation({
        feedName: "WsEvents",
        feedArgs: { Port: port + "" },
        actionName: "Event",
        actionData: actionData,
        feedDeltas: []
      });
    });
  });

  // Return success to the browser
  ares.success({});
};

proto._controllerActions.InvokeWsMethod = function(areq, ares) {
  dbg("Received InvokeWsMethod action request");

  // Make sure the port reference is valid
  var wsServer = this._wsServers[areq.actionArgs.Port + ""];
  if (!wsServer) {
    ares.wsServer("INVALID_PORT", {});
    return;
  }

  // Make sure the method is valid
  var method = wsServer[areq.actionArgs.Method];
  if (!method) {
    ares.failure("INVALID_METHOD", {});
    return;
  }

  // Run the method and get the result
  var ret;
  try {
    ret = method.apply(wsServer, areq.actionArgs.Arguments);
  } catch (e) {
    ares.failure("ERROR_THROWN", { Error: e.toString() });
    return;
  }

  // Return the result to the client
  if (ret === undefined) {
    ares.success({}); // can't serialize undefined
  } else {
    ares.success({ ReturnValue: ret });
  }
};

proto._controllerActions.InvokeWsClientMethod = function(areq, ares) {
  dbg("Received InvokeWsClientMethod action request");

  // Make sure the port reference is valid
  var wsServer = this._wsServers[areq.actionArgs.Port + ""];
  if (!wsServer) {
    ares.wsServer("INVALID_PORT", {});
    return;
  }

  // Make sure the client is valid
  var wsClient = this._wsServerClients[areq.actionArgs.Port + ""][
    areq.actionArgs.ClientId
  ];
  if (!wsClient) {
    ares.failure("INVALID_CLIENT", {});
    return;
  }

  // Make sure the method is valid
  var method = wsClient[areq.actionArgs.Method];
  if (!method) {
    ares.failure("INVALID_METHOD", {});
    return;
  }

  // Run the method and get the result
  var ret;
  try {
    ret = method.apply(wsClient, areq.actionArgs.Arguments);
  } catch (e) {
    ares.failure("ERROR_THROWN", { Error: e.toString() });
    return;
  }

  // Return the result to the client
  if (ret === undefined) {
    ares.success({}); // can't serialize undefined
  } else {
    ares.success({ ReturnValue: ret });
  }
};

proto._controllerActions.DestroyWsServer = function(areq, ares) {
  dbg("Received DestroyWsServer action request");

  // Make sure the port reference is valid
  var wsServer = this._wsServers[areq.actionArgs.Port + ""];
  if (!wsServer) {
    ares.failure("INVALID_PORT", {});
    return;
  }

  // Remove server reference and server/client listeners
  for (cid in this._wsServerClients[areq.actionArgs.Port + ""]) {
    this._wsServerClients[areq.actionArgs.Port + ""][cid].removeAllListeners();
  }
  wsServer.removeAllListeners();
  delete this._wsServers[areq.actionArgs.Port + ""];
  delete this._wsServerClients[areq.actionArgs.Port + ""];

  // Stop the server if necessary - no way to check state, so try and ignore errors
  try {
    wsServer.close();
  } catch (e) {}

  // Return success
  ares.success({});
};

// Transport server actions

proto._controllerActions.CreateTransportServer = function(areq, ares) {
  dbg("Received CreateTransportServer action request");

  var _this = this;

  // Create a new transport server
  var port = this._getNextPort();
  var transportServer = feedmeTransportWsServer({
    port: port
  });
  this._transportServers[port + ""] = transportServer;

  // When the server emits an event, reveal an action on the controller TransportEvents feed
  [
    "starting",
    "start",
    "stopping",
    "stop",
    "connect",
    "message",
    "disconnect"
  ].forEach(function(evt) {
    transportServer.on(evt, function() {
      dbg("Observed transport server " + evt + " event");
      var args = [];
      _.each(arguments, function(val) {
        args.push(_this._getJsonExpressible(val));
      });
      var actionData = { EventName: evt, Arguments: args };
      _this._fmControllerServer.actionRevelation({
        feedName: "TransportEvents",
        feedArgs: { Port: port + "" },
        actionName: "Event",
        actionData: actionData,
        feedDeltas: []
      });
    });
  });

  // Return success to the browser
  ares.success({ Port: port });
};

proto._controllerActions.InvokeTransportMethod = function(areq, ares) {
  dbg("Received InvokeTransportMethod action request");

  // Make sure the port reference is valid
  var transportServer = this._transportServers[areq.actionArgs.Port + ""];
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
    ret = method.apply(transportServer, areq.actionArgs.Arguments);
  } catch (e) {
    ares.failure("ERROR_THROWN", { Error: e.toString() });
    return;
  }

  // Return the result to the client
  if (ret === undefined) {
    ares.success({}); // can't serialize undefined
  } else {
    ares.success({ ReturnValue: ret });
  }
};

proto._controllerActions.DestroyTransportServer = function(areq, ares) {
  dbg("Received DestroyTransportServer action request");

  // Make sure the port reference is valid
  var transportServer = this._transportServers[areq.actionArgs.Port + ""];
  if (!transportServer) {
    ares.failure("INVALID_PORT", {});
    return;
  }

  // Remove transport server reference and listeners
  delete this._transportServers[areq.actionArgs.Port + ""];
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

// Feedme server actions
