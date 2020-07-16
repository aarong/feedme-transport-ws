/* eslint-disable import/no-extraneous-dependencies */
import uuid from "uuid";
import _ from "lodash";
import express from "express";
import feedmeServerCore from "feedme-server-core";
import WebSocket from "ws";
import jsonExpressible from "json-expressible";
import debug from "debug";
import feedmeTransportWsServer from "../../build/server";
import asyncUtil from "./asyncutil";

const dbg = debug("feedme-transport-ws:browser-test-server");

/*

Web server for browser tests.

- An Express web server delivers static content, including tests.

- A Feedme API (the "server controller API") allows the client to create and
interact with WebSocket, transport, and Feedme servers. Each server is created
on a unique port and is identified by its port number.

- The browser is only tested against WebSocket, transport, and Feedme servers
running on stand-alone servers (i.e. no external server or noServer
configurations - out of scope).

There are a few complications with the raw WebSocket server controller:

  - The ws server begins listening immediately on initialization, so you need
  an action to first establish a port on which the client can listen for
  events (namely the listening event), and then another action to actually
  initialize the server.

  - The ws server represents clients as objects with their own methods, so you
  need to:
      - Assign a client id to each connection and attach it to the connection event
      - Have an InvokeWsClientMethod action that enables invokation by client id
      - Reveal ws client events on WsEvents, prepending the event name with "Client"
        and attaching the client id to the action data

Controller Actions

  EstablishWsPort
    Args: {}
    Returns: { Port }
  InitWsServer
    Args: { Port }
    Returns: {}
  InitTransportServer
    Args: {}
    Returns: { Port }
  InitFeedmeServer
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

Controller Feeds
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

const proto = {};

// Asynchronous factory function that calls back a server object once listening
export default async function testServer(port) {
  dbg("Starting test server");
  const server = Object.create(proto);

  // Internal members
  server._nextPort = 10000;
  server._wsServers = {}; // Indexed by port
  server._wsServerClients = {}; // Indexed by port and then client id
  server._transportServers = {}; // Indexed by port
  server._feedmeServers = {}; // Indexed by port

  // Create the webserver and wait for it to begin listening
  const e = express();
  e.use("/", express.static(`${__dirname}/webroot`));
  server._httpServer = e.listen(port);
  await asyncUtil.once(server._httpServer, "listening");

  // Create the Feedme controller API and wait for it to start
  server._fmControllerServer = feedmeServerCore({
    transport: feedmeTransportWsServer({
      server: server._httpServer
    })
  });
  server._fmControllerServer.on("action", (areq, ares) => {
    // Route actions to controller methods
    dbg(`Received ${areq.actionName} action request`);
    server._controllerActions[areq.actionName].bind(server)(areq, ares);
  });
  server._fmControllerServer.on("feedOpen", (foreq, fores) => {
    // Permit any feed to be opened
    dbg(`Received ${foreq.feedName} feed open request`);
    fores.success({});
  });
  server._fmControllerServer.start();
  await asyncUtil.once(server._fmControllerServer, "start");

  return server._httpServer;
}

proto.close = function close(cb) {
  dbg("Stopping server");
  this._fmControllerServer.stop();
  this._httpServer.close(cb);
};

proto._getNextPort = async function _getNextPort() {
  // Return a port that can be listener on
  // Browsers consider ports 10000+ safe, which is the starting point

  let port;
  do {
    // Get the next unused port
    port = this._nextPort;
    this._nextPort += 1;

    // Ensure that you can listen on it
    const wss = new WebSocket.Server({ port });
    wss.on("error", () => {}); // Don't die on uncaught exceptions
    // eslint-disable-next-line no-await-in-loop
    const result = await new Promise(resolve => {
      ["listening", "close"].forEach(evt => {
        wss.removeAllListeners();
        resolve(evt);
      });
    });

    // Found a good port?
    if (result === "listening") {
      wss.close();
      await asyncUtil.once(wss, "close"); // eslint-disable-line no-await-in-loop
      break;
    }
  } while (true); // eslint-disable-line no-constant-condition

  return port;
};

proto._getJsonExpressible = function _getJsonExpressible(a) {
  // Make things like Error and ws client objects JSON-expressible
  return jsonExpressible(a) ? a : a.toString();
};

proto._controllerActions = {};

// WebSocket server actions

proto._controllerActions.EstablishWsPort = async function EstablishWsPort(
  areq,
  ares
) {
  const port = await this._getNextPort();
  this._wsServers[`${port}`] = null;
  this._wsServerClients[`${port}`] = {};
  ares.success({ Port: port });
};

proto._controllerActions.InitWsServer = function InitWsServer(areq, ares) {
  // Ensure the port has been created and not yet used
  const port = areq.actionArgs.Port;
  if (this._wsServers[`${port}`] !== null) {
    ares.error("INVALID_PORT", "Port not created or server already present.");
    return;
  }

  // Create a new WebSocket server on the specified port
  const wsServer = new WebSocket.Server({
    port
  });
  this._wsServers[`${port}`] = wsServer;

  // When the server emits a connection event, assign a client id, save the ws
  // client reference, and reveal ws client actions on WsEvents feed
  wsServer.on("connection", ws => {
    dbg("Observed WebSocket server connection event");
    // Assign a client id and store the WebSocket object
    const cid = uuid();
    this._wsServerClients[`${port}`][cid] = ws;

    // Listen for and reveal client socket events on the WsEvents feed
    ["Message", "Close", "Error"].forEach(evt => {
      ws.on(evt.toLowerCase(), (...args) => {
        dbg(`Observed WebSocket server client ${evt.toLowerCase()} event`);
        this._fmControllerServer.actionRevelation({
          feedName: "WsEvents",
          feedArgs: { Port: `${port}` },
          actionName: "Event",
          actionData: {
            Name: `client${evt}`,
            ClientId: cid,
            Arguments: args.map(val => this._getJsonExpressible(val))
          },
          feedDeltas: []
        });
      });
    });

    // Reveal the client connection event on the WsEvents feed (no arguments)
    this._fmControllerServer.actionRevelation({
      feedName: "WsEvents",
      feedArgs: { Port: `${port}` },
      actionName: "Event",
      actionData: {
        Name: "connection",
        ClientId: cid,
        Arguments: []
      },
      feedDeltas: []
    });
  });

  // When the server emits any other event, reveal it on the WsEvents feed
  ["listening", "close", "error"].forEach(evt => {
    wsServer.on(evt, (...args) => {
      dbg(`Observed WebSocket server ${evt} event`);
      this._fmControllerServer.actionRevelation({
        feedName: "WsEvents",
        feedArgs: { Port: `${port}` },
        actionName: "Event",
        actionData: {
          Name: evt,
          Arguments: args.map(val => this._getJsonExpressible(val))
        },
        feedDeltas: []
      });
    });
  });

  // Return success to the browser
  ares.success({});
};

proto._controllerActions.InvokeWsMethod = function InvokeWsMethod(areq, ares) {
  // Make sure the port reference is valid
  const wsServer = this._wsServers[`${areq.actionArgs.Port}`];
  if (!wsServer) {
    ares.failure("INVALID_PORT", {});
    return;
  }

  // Make sure the method is valid
  const method = wsServer[areq.actionArgs.Method];
  if (!method) {
    ares.failure("INVALID_METHOD", {});
    return;
  }

  // Run the method and get the result
  let ret;
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

proto._controllerActions.InvokeWsClientMethod = function InvokeWsClientMethod(
  areq,
  ares
) {
  // Make sure the port reference is valid
  const wsServer = this._wsServers[`${areq.actionArgs.Port}`];
  if (!wsServer) {
    ares.failure("INVALID_PORT", {});
    return;
  }

  // Make sure the client is valid
  const wsClient = this._wsServerClients[`${areq.actionArgs.Port}`][
    areq.actionArgs.ClientId
  ];
  if (!wsClient) {
    ares.failure("INVALID_CLIENT", {});
    return;
  }

  // Make sure the method is valid
  const method = wsClient[areq.actionArgs.Method];
  if (!method) {
    ares.failure("INVALID_METHOD", {});
    return;
  }

  // Allow passing a binary argument using "binary"
  const args = areq.actionArgs.Arguments.map(arg =>
    arg === "binary" ? new Float32Array(5) : arg
  );

  // Run the method and get the result
  let ret;
  try {
    ret = method.apply(wsClient, args);
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

proto._controllerActions.DestroyWsServer = async function DestroyWsServer(
  areq,
  ares
) {
  // Make sure the port reference is valid
  const wsServer = this._wsServers[`${areq.actionArgs.Port}`];
  if (!wsServer) {
    ares.failure("INVALID_PORT", {});
    return;
  }

  // Stop the server (no way to check state so try/catch)
  try {
    wsServer.close();
  } catch (e) {
    // Was already not listening
  }

  // Remove server reference and server/client listeners
  _.each(this._wsServerClients[`${areq.actionArgs.Port}`], ws => {
    ws.removeAllListeners();
  });
  wsServer.removeAllListeners();
  delete this._wsServers[`${areq.actionArgs.Port}`];
  delete this._wsServerClients[`${areq.actionArgs.Port}`];

  // Return success
  ares.success({});
};

// Transport server actions

proto._controllerActions.InitTransportServer = async function InitTransportServer(
  areq,
  ares
) {
  // Create a new transport server on an available port
  const port = await this._getNextPort();
  const transportServer = feedmeTransportWsServer({ port });
  this._transportServers[`${port}`] = transportServer;

  // When the server emits an event, reveal it on the TransportEvents feed
  [
    "starting",
    "start",
    "stopping",
    "stop",
    "connect",
    "message",
    "disconnect"
  ].forEach(evt => {
    transportServer.on(evt, (...args) => {
      dbg(`Observed Transport server ${evt} event`);
      this._fmControllerServer.actionRevelation({
        feedName: "TransportEvents",
        feedArgs: { Port: `${port}` },
        actionName: "Event",
        actionData: {
          Name: evt,
          Arguments: args.map(val => this._getJsonExpressible(val))
        },
        feedDeltas: []
      });
    });
  });

  // Return port to the browser
  ares.success({ Port: port });
};

proto._controllerActions.InvokeTransportMethod = function InvokeTransportMethod(
  areq,
  ares
) {
  // Make sure the port reference is valid
  const transportServer = this._transportServers[`${areq.actionArgs.Port}`];
  if (!transportServer) {
    ares.failure("INVALID_PORT", {});
    return;
  }

  // Make sure the method is valid
  const method = transportServer[areq.actionArgs.Method];
  if (!method) {
    ares.failure("INVALID_METHOD", {});
    return;
  }

  // Run the method and get the result
  let ret;
  try {
    ret = method.apply(transportServer, areq.actionArgs.Arguments);
  } catch (e) {
    ares.failure("ERROR_THROWN", { Error: e.toString() });
    return;
  }

  // Return the result to the client
  if (ret === undefined) {
    ares.success({}); // can't JSON-serialize undefined
  } else {
    ares.success({ ReturnValue: ret });
  }
};

proto._controllerActions.DestroyTransportServer = async function DestroyTransportServer(
  areq,
  ares
) {
  // Make sure the port reference is valid
  const transportServer = this._transportServers[`${areq.actionArgs.Port}`];
  if (!transportServer) {
    ares.failure("INVALID_PORT", {});
    return;
  }

  // Stop the server if not already and remove reference
  if (transportServer.state() === "started") {
    transportServer.stop();
  }
  delete this._transportServers[`${areq.actionArgs.Port}`];

  // Return success
  ares.success({});
};

// Feedme server actions

proto._controllerActions.InitFeedmeServer = async function InitFeedmeServer(
  areq,
  ares
) {
  // Create a new Feedme server on an available port
  const port = await this._getNextPort();
  const feedmeServer = feedmeServerCore({
    transport: feedmeTransportWsServer({ port })
  });
  this._feedmeServers[`${port}`] = feedmeServer;

  // When the server emits a basic event, reveal it on the FeedmeEvents feed
  ["starting", "start", "stopping", "stop", "connect", "disconnect"].forEach(
    evt => {
      feedmeServer.on(evt, (...args) => {
        dbg(`Observed Feedme server ${evt} event`);
        this._fmControllerServer.actionRevelation({
          feedName: "FeedmeEvents",
          feedArgs: { Port: `${port}` },
          actionName: "Event",
          actionData: {
            Name: evt,
            Arguments: args.map(val => this._getJsonExpressible(val))
          },
          feedDeltas: []
        });
      });
    }
  );

  // Allow clients to run one action successfully and fail all others
  feedmeServer.on("action", (areq2, ares2) => {
    if (areq2.actionName === "successful_action") {
      ares2.success({ Action: "Data" });
    } else {
      ares2.failure("SOME_ERROR", { Error: "Data" });
    }
  });

  // Allow clients to open one feed successfully and fail all others
  feedmeServer.on("feedOpen", (foreq, fores) => {
    if (foreq.feedName === "successful_feed") {
      fores.success({ Feed: "Data" });
    } else {
      fores.failure("SOME_ERROR", { Error: "Data" });
    }
  });

  // Return port to the browser
  ares.success({ Port: port });
};

proto._controllerActions.InvokeFeedmeMethod = function InvokeFeedmeMethod(
  areq,
  ares
) {
  // Make sure the port reference is valid
  const feedmeServer = this._feedmeServers[`${areq.actionArgs.Port}`];
  if (!feedmeServer) {
    ares.failure("INVALID_PORT", {});
    return;
  }

  // Make sure the method is valid
  const method = feedmeServer[areq.actionArgs.Method];
  if (!method) {
    ares.failure("INVALID_METHOD", {});
    return;
  }

  // Run the method and get the result
  let ret;
  try {
    ret = method.apply(feedmeServer, areq.actionArgs.Arguments);
  } catch (e) {
    ares.failure("ERROR_THROWN", { Error: e.toString() });
    return;
  }

  // Return the result to the client
  if (ret === undefined) {
    ares.success({}); // can't JSON-serialize undefined
  } else {
    ares.success({ ReturnValue: ret });
  }
};

proto._controllerActions.DestroyFeedmeServer = async function DestroyFeedmeServer(
  areq,
  ares
) {
  // Make sure the port reference is valid
  const feedmeServer = this._feedmeServers[`${areq.actionArgs.Port}`];
  if (!feedmeServer) {
    ares.failure("INVALID_PORT", {});
    return;
  }

  // Stop the server if not already and remove reference
  if (feedmeServer.state() === "started") {
    feedmeServer.stop();
  }
  delete this._feedmeServers[`${areq.actionArgs.Port}`];

  // Return success
  ares.success({});
};
