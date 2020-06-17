import emitter from "component-emitter";
import uuid from "uuid";
import debug from "debug";
import check from "check-types";
import _ from "lodash";
import http from "http";
import stream from "stream";
import serverConfig from "./server.config";
import config from "./config";

const dbg = debug("feedme-transport-ws:server");

/**
 * Server transport object.
 *
 * The ws module does not provide a way to reuse a server object once closed,
 * so a new one is initialized for each start/stop cycle. The WebSocket.Server
 * constructor is injected to facilitate testing.
 *
 * Server modes:
 *
 *  - When ws is running in stand-alone mode, listen for listening/close/error
 * events on ws.
 *
 * - When ws is running in external http server mode, listen for
 * listening/close/error events on the external http server, as ws does not emit
 * them reliably. Also poll the http server to determine whether it is still
 * listening, as calls to httpServer.close() do not force connections closed
 * and an http server close event is not emitted until all WebSocket clients
 * depart.
 *
 * - When ws is running in noServer mode, there is no server status to monitor.
 *
 * @typedef {Object} Server
 * @extends emitter
 */

const proto = {};
emitter(proto);

/**
 * Transport server factory function.
 * @param {Function} wsConstructor WebSocket.Server constuctor
 * @param {Object} options Options for WebSocket.Server plus transport heartbeat config
 * @throws {Error} "INVALID_ARGUMENT: ..."
 * @returns {Server}
 */
export default function serverFactory(wsConstructor, options) {
  dbg("Initializing Server object");

  // Validate wsConstructor
  if (!check.function(wsConstructor)) {
    throw new Error("INVALID_ARGUMENT: Invalid wsConstructor argument.");
  }

  // Validate options
  if (!check.object(options)) {
    throw new Error("INVALID_ARGUMENT: Invalid options argument.");
  }

  // Clone the app-supplied options object to avoid modifying it if using the
  // default heartbeat configuration
  const tOptions = _.clone(options);

  // Validate core ws options - leave the rest to ws on initialization
  if (
    "port" in tOptions &&
    (!check.integer(tOptions.port) ||
      tOptions.port < 0 ||
      tOptions.port > 65535)
  ) {
    throw new Error("INVALID_ARGUMENT: Invalid options.port argument.");
  }
  if ("server" in tOptions && !check.object(tOptions.server)) {
    throw new Error("INVALID_ARGUMENT: Invalid options.server argument.");
  }
  if ("noServer" in tOptions && !check.boolean(tOptions.noServer)) {
    throw new Error("INVALID_ARGUMENT: Invalid options.noServer argument.");
  }
  if (
    !("port" in tOptions) &&
    !("server" in tOptions) &&
    !("noServer" in tOptions)
  ) {
    throw new Error(
      "INVALID_ARGUMENT: Must specify a valid port, server, or noServer option."
    );
  }

  // Ensure that the application does not specify options.handleProtocols,
  // which is used internally by the transport to validate client subprotocols
  if ("handleProtocols" in tOptions) {
    throw new Error(
      "INVALID_ARGUMENT: Must not specify options.handleProtocols."
    );
  }

  // Validate tOptions.heartbeatIntervalMs (if specified) and overlay default
  if ("heartbeatIntervalMs" in tOptions) {
    if (
      !check.integer(tOptions.heartbeatIntervalMs) ||
      tOptions.heartbeatIntervalMs < 0
    ) {
      throw new Error(
        "INVALID_ARGUMENT: Invalid options.heartbeatIntervalMs argument."
      );
    }
  } else {
    tOptions.heartbeatIntervalMs = serverConfig.defaults.heartbeatIntervalMs;
  }

  // Validate tOptions.heartbeatTimeoutMs (if specified) and overlay default
  if ("heartbeatTimeoutMs" in tOptions) {
    if (
      !check.integer(tOptions.heartbeatTimeoutMs) ||
      tOptions.heartbeatTimeoutMs <= 0 ||
      tOptions.heartbeatTimeoutMs >= tOptions.heartbeatIntervalMs
    ) {
      throw new Error(
        "INVALID_ARGUMENT: Invalid options.heartbeatTimeoutMs argument."
      );
    }
  } else {
    tOptions.heartbeatTimeoutMs = serverConfig.defaults.heartbeatTimeoutMs;
  }

  // Success

  const server = Object.create(proto);

  /**
   * WebSocket.Server constructor function. Injected to facilitate unit tests.
   * @memberof Server
   * @instance
   * @private
   * @type {Function}
   */
  server._wsConstructor = wsConstructor;

  /**
   * WebSocket server instance. Null if the transport state is stopped.
   *
   * A new server instance is created for each start/stop cycle, because the
   * ws server begins listening immediately on initialization and there is no
   * way to restart a ws server once stopped.
   * @memberof Server
   * @instance
   * @private
   * @type {?Object}
   */
  server._wsServer = null;

  /**
   * Server state: "stopped", "starting", "started", or "stopping".
   * @memberof Server
   * @instance
   * @private
   * @type {Object}
   */
  server._state = "stopped";

  /**
   * Connected clients.
   *
   * this._wsClients[clientId] = WebSocket instance
   *
   * @memberof Server
   * @instance
   * @private
   * @type {Object}
   */
  server._wsClients = {};

  /**
   * Heartbeat intervals for clients.
   *
   * this._heartbeatIntervals[clientId] = interval id or missing if heartbeats disabled
   *
   * @memberof Server
   * @instance
   * @private
   * @type {Object}
   */
  server._heartbeatIntervals = {};

  /**
   * Heartbeat timeouts for clients.
   *
   * this._heartbeatTimeouts[clientId] = timeout id or missing
   *
   * Missing if not awaiting pong or heartbeats are disabled.
   *
   * @memberof Server
   * @instance
   * @private
   * @type {Object}
   */
  server._heartbeatTimeouts = {};

  /**
   * Application-specified options.
   * @memberof Server
   * @instance
   * @private
   * @type {Object}
   */
  server._options = tOptions;

  /**
   * The listening/close/error event handlers attached to the external http
   * server, if operating in that mode. Retained so that external listeners can
   * be removed when the transport server stops.
   *
   * If present: { listening: fn, close: fn, error: fn }
   *
   * Null if not operating in external server mode or transport not
   * starting/started.
   * @memberof Server
   * @instance
   * @private
   * @type {?Object}
   */
  server._httpHandlers = null;

  /**
   * Interval that polls the external http server to verify that it is still
   * listening. Null if not running in external server mode or transport not
   * started.
   *
   * You cannot rely only on the http server close event to monitor whether the
   * external server is listening. A call to httpServer.close() does not kill
   * outstanding connections (including WebSocket connections, which can persist
   * indefinetely) and the http close event is only emitted after all clients
   * have disconnected.
   * @memberof Server
   * @instance
   * @private
   * @type {?number}
   */
  server._httpPollingInterval = null;

  return server;
}

// Events

/**
 * @event starting
 * @memberof Server
 * @instance
 */

/**
 * @event start
 * @memberof Server
 * @instance
 */

/**
 * @event stopping
 * @memberof Server
 * @instance
 * @param {?Error} err "FAILURE: ..." if not due to call to server.stop()
 */

/**
 * @event stop
 * @memberof Server
 * @instance
 * @param {?Error} err "FAILURE: ..." if not due to call to server.stop()
 */

/**
 * @event connect
 * @memberof Server
 * @instance
 * @param {string} clientId
 */

/**
 * @event message
 * @memberof Server
 * @instance
 * @param {string} clientId
 * @param {string} msg
 */

/**
 * @event disconnect
 * @memberof Server
 * @instance
 * @param {string} clientId
 * @param {?Error} err  "STOPPING: ..." if the due to a call to server.stop()
 *                      "FAILURE: ..." if the transport failed
 *                      Not present if due to call to server.disconnect(...)
 */

/**
 * Returns the server state: "stopped", "starting", "started", or "stopping".
 * @memberof Server
 * @instance
 * @returns {string}
 */
proto.state = function state() {
  dbg("State requested");
  return this._state;
};

/**
 * Starts the server.
 * @memberof Server
 * @instance
 * @throws {Error} "INVALID_STATE: ..."
 * @returns {void}
 */
proto.start = function start() {
  dbg("Start requested");

  // Check state
  if (this._state !== "stopped") {
    throw new Error("INVALID_STATE: The server is not stopped.");
  }

  // Update state and emit
  this._state = "starting";
  this._emitAsync("starting");

  // Assemble ws options
  const wsOptions = _.clone(this._options);
  delete wsOptions.heartbeatIntervalMs;
  delete wsOptions.heartbeatTimeoutMs;
  wsOptions.handleProtocols = this._processHandleProtocols.bind(this);

  // Try to initialize the ws server
  try {
    this._wsServer = new this._wsConstructor(wsOptions);
  } catch (e) {
    dbg("Ws server constructor threw an error");
    dbg(e);

    // Emit stopping and stop
    // State immediately becomes stopped because a call to transport.start() is valid
    this._state = "stopped";
    const err = new Error("FAILURE: Could not initialize WebSocket server.");
    err.wsError = e;
    this._emitAsync("stopping", err);
    this._emitAsync("stop", err);
    return; // Stop
  }

  // Listen for server status events
  // Ws does not reliably emit these events when in external server mode, so:
  // - If running in stand-alone mode, listen for ws listening/close/error
  // - If running in external server mode, listen for external http listening/close/error
  // - If running in noServer mode, then there are no server status events to monitor
  if (this._options.port) {
    dbg("Listening for ws listening, close, and error events");
    ["listening", "close", "error"].forEach(evt => {
      const listener = this[`_processServer${_.startCase(evt)}`].bind(this);
      this._wsServer.on(evt, listener);
    });
  } else if (this._options.server) {
    dbg("Listening for external http listening, close, and error events");
    this._httpHandlers = {};
    ["listening", "close", "error"].forEach(evt => {
      const listener = this[`_processServer${_.startCase(evt)}`].bind(this);
      this._httpHandlers[evt] = listener;
      this._options.server.on(evt, listener);
    });

    // Ws server will emit error if the external http server does
    // Listen for it to prevent unhandled errors
    this._wsServer.on("error", () => {});
  }

  // Listen for ws client connection events
  this._wsServer.on("connection", this._processWsServerConnection.bind(this));

  // The server should immediately become started if:
  // - Running in external server mode and the server is already listening
  // - Running in noServer mode, as there is no knowledge of the outside server
  if (
    (this._options.server && this._options.server.listening) ||
    this._options.noServer
  ) {
    dbg("External http server is already started or in noServer mode");
    this._start();
  }
};

/**
 * Stops the server.
 * @memberof Server
 * @instance
 * @throws {Error} "INVALID_STATE: ..."
 * @returns {void}
 */
proto.stop = function stop() {
  dbg("Stop requested");

  // Check state
  if (this._state !== "started") {
    throw new Error("INVALID_STATE: The server is not started.");
  }

  // Success

  this._stop();
};

/**
 * Sends a message to a client.
 * @memberof Server
 * @instance
 * @param {string} cid
 * @param {string} msg
 * @throws {Error} "INVALID_ARGUMENT: ..."
 * @throws {Error} "INVALID_STATE: ..."
 * @returns {void}
 */
proto.send = function send(cid, msg) {
  dbg("Send requested");

  // Check arguments
  if (!check.string(cid) || !check.string(msg)) {
    throw new Error("INVALID_ARGUMENT: Invalid client id or message.");
  }

  // Check server state
  if (this._state !== "started") {
    throw new Error("INVALID_STATE: The server is not started.");
  }

  // Check client state
  if (!(cid in this._wsClients)) {
    throw new Error("INVALID_STATE: The client is not connected.");
  }

  // Try to send the message
  this._wsClients[cid].send(msg, err => {
    if (err) {
      dbg("Error writing message to WebSocket");
      const transportErr = new Error("FAILURE: WebSocket transmission failed.");
      transportErr.wsError = err;
      this._disconnect(cid, transportErr);
    } else {
      dbg("Message successfully written to WebSocket");
    }
  });
};

/**
 * Disconnects a client.
 * @memberof Server
 * @instance
 * @param {string} cid
 * @param {?Error} err
 * @throws {Error} "INVALID_ARGUMENT: ..."
 * @throws {Error} "INVALID_STATE: ..."
 * @returns {void}
 */
proto.disconnect = function disconnect(...args) {
  dbg("Disconnect requested");

  // Check client id
  if (!check.string(args[0])) {
    throw new Error("INVALID_ARGUMENT: Invalid client id.");
  }
  const cid = args[0];

  // Check error (if specified)
  if (args.length > 1 && !check.instance(args[1], Error)) {
    throw new Error("INVALID_ARGUMENT: Invalid error.");
  }
  const err = args[1] || null;

  // Check server state
  if (this._state !== "started") {
    throw new Error("INVALID_STATE: The server is not started.");
  }

  // Check client state
  if (!(cid in this._wsClients)) {
    throw new Error("INVALID_STATE: The client is not connected.");
  }

  // Success

  this._disconnect(cid, err);
};

/**
 * Used by the application to pipe in WebSocket upgrade requests when operating
 * in noServer mode.
 * @memberof Server
 * @instance
 * @param {http.IncomingMessage} request
 * @param {stream.Duplex} socket
 * @param {Buffer} head
 * @throws {Error} "INVALID_ARGUMENT: ..."
 * @throws {Error} "INVALID_STATE: ..."
 * @returns {void}
 */
proto.handleUpgrade = function handleUpgrade(request, socket, head) {
  dbg("WebSocket upgrade requested");

  // Check arguments
  if (
    !check.instance(request, http.IncomingMessage) ||
    !check.instance(socket, stream.Duplex) ||
    !Buffer.isBuffer(head)
  ) {
    throw new Error("INVALID_ARGUMENT: Invalid request, socket, or head.");
  }

  // Check that ws is in noServer mode
  if (!this._options.noServer) {
    throw new Error("INVALID_STATE: The transport is not in noServer mode.");
  }

  // Check transport state
  if (this._state !== "started") {
    throw new Error("INVALID_STATE: The transport server is not started.");
  }

  // Success
  // The callback is only fired by ws if the upgrade is completed successfully
  this._wsServer.handleUpgrade(request, socket, head, ws => {
    dbg("Received callback from ws.handleUpgrade()");
    this._wsServer.emit("connection", ws, request);
  });
};

/**
 * Processes a ws or external http server listening event.
 * @memberof Server
 * @instance
 * @private
 * @returns {void}
 */
proto._processServerListening = function _processServerListening() {
  dbg("Observed ws or external http listening event");
  this._start();
};

/**
 * Processes a ws or external http server close event.
 *
 * The server.stop() method removes all ws and external http server event
 * listeners before actually stopping the server, so this method is called
 * only when the server stops unexpectedly.
 * @memberof Server
 * @instance
 * @private
 * @returns {void}
 */
proto._processServerClose = function _processServerClose() {
  dbg("Observed ws or external http close event");
  this._stop(new Error("FAILURE: The server stopped unexpectedly."));
};

/**
 * Processes a ws or external http server error event.
 *
 * Http and ws servers emit only "error" and not "close" if they fail to begin
 * listening, so need to monitor this event as well. And to avoid uncaught
 * exceptions.
 * @memberof Client
 * @instance
 * @private
 * @param {Error} err
 * @returns {void}
 */
proto._processServerError = function _processServerError(err) {
  dbg("Observed ws or external http server error event");
  dbg(err);

  const emitErr = new Error("FAILURE: Failed to listen for connections.");
  emitErr.wsError = err;
  this._stop(emitErr);
};

/**
 * Processes a ws server "connection" event.
 * @memberof Server
 * @instance
 * @private
 * @param {Object} ws
 * @returns {void}
 */
proto._processWsServerConnection = function _processWsServerConnection(ws) {
  dbg("Observed ws connection event");

  // Assign an id and store a reference to the ws client
  const cid = uuid();
  this._wsClients[cid] = ws;

  // Set heartbeat status and start the heartbeat interval (if so configured)
  if (this._options.heartbeatIntervalMs > 0) {
    this._heartbeatIntervals[cid] = setInterval(() => {
      dbg("Starting heartbeat timeout");

      // Start the heartbeat timeout
      // Cleared on pong receipt, client disconnect, and server stoppage
      this._heartbeatTimeouts[cid] = setTimeout(() => {
        dbg("Heartbeat timed out");
        this._disconnect(
          cid,
          new Error("FAILURE: The WebSocket heartbeat failed.")
        );
      }, this._options.heartbeatTimeoutMs);

      // Ping the client - ws automatically responds with pong
      this._wsClients[cid].ping(err => {
        if (err) {
          dbg("Error writing ping frame");
          const transportErr = new Error(
            "FAILURE: The WebSocket heartbeat failed."
          );
          transportErr.wsError = err;
          this._disconnect(cid, transportErr);
        } else {
          dbg("Ping frame written successfully");
        }
      });
    }, this._options.heartbeatIntervalMs);
  }

  // Listen for ws client events
  ["message", "pong", "close", "error"].forEach(evt => {
    const listener = this[`_processWsClient${_.startCase(evt)}`].bind(
      this,
      cid
    );
    ws.on(evt, listener);
  });

  // Emit transport connect
  this._emitAsync("connect", cid);
};

/**
 * Processes a ws client message event.
 * @memberof Server
 * @instance
 * @private
 * @param {string} cid
 * @param {string} msg
 * @returns {void}
 */
proto._processWsClientMessage = function _processWsClientMessage(cid, msg) {
  dbg("Observed ws client message event");

  // Check data type - cold be String, Buffer, ArrayBuffer, Buffer[]
  if (!check.string(msg)) {
    dbg("Non-string message received on WebSocket");
    this.disconnect(
      cid,
      new Error("FAILURE: Received non-string message on WebSocket connection.")
    );
    return; // Stop
  }

  this._emitAsync("message", cid, msg);
};

/**
 * Processes a ws client pong event.
 * @memberof Server
 * @instance
 * @private
 * @param {string} cid
 * @returns {void}
 */
proto._processWsClientPong = function _processWsClientPong(cid) {
  dbg("Observed ws client pong event");

  // Clear the heartbeat timeout
  clearTimeout(this._heartbeatTimeouts[cid]);
  delete this._heartbeatTimeouts[cid];
};

/**
 * Processes a ws client close event.
 *
 * The client close event is fired...
 *
 * - On server stoppage after the server-level close event
 * - On server call to ws.close() or ws.terminate()
 * - On client call to ws.close() or ws.terminate()
 *
 * The _disconnect() and _stop() methods remove ws client event listeners, so
 * this function is called only when a client disconnects unexpectedly.
 * @memberof Server
 * @instance
 * @private
 * @param {string} cid
 * @param {number} code
 * @param {string} reason
 * @returns {void}
 */
proto._processWsClientClose = function _processWsClientClose(
  cid,
  code,
  reason
) {
  dbg("Observed ws client close event");

  const err = new Error("FAILURE: The WebSocket closed.");
  err.wsCode = code;
  err.wsReason = reason;
  this._disconnect(cid, err);
};

/**
 * Processes a ws client error event.
 * The ws module also fires a close event when an error occurs. This method
 * is required to prevent unhandled errors and for debugging.
 * @memberof Client
 * @instance
 * @private
 * @param {string} cid
 * @param {Error} err
 * @returns {void}
 */
proto._processWsClientError = function _processWsClientError(cid, err) {
  dbg("Observed ws client error event");
  dbg(err);
};

/**
 * Called by ws when a client WebSocket connection request specifies one or
 * more subprotocols. Not strictly an event handler - a bound reference to this
 * function is passed to ws on initialization.
 *
 * When there is a new connection...
 *
 * - If there is a "feedme" protocol present then the connection is accepted and
 * the feedme protocol is selected.
 *
 * - If there is no "feedme" protocol present then the connection is terminated.
 *
 * The WebSocket standard calls for subprotocols to be considered on a
 * case-sensitive basis. The comparison here is intentionally case-insensitive,
 * but the original casing is preserved in the response to the client.
 *
 * If a client initiates a WebSocket connection without specifying any
 * subprotocols then ws automatically accepts the connection without calling
 * this function, which is fine.
 * @memberof Client
 * @instance
 * @private
 * @param {Array} protocols Always contains at least one protocol element
 * @returns {string|boolean}
 */
proto._processHandleProtocols = function _processHandleProtocols(protocols) {
  dbg(`Ws handleProtocols request: ${protocols.join(",")}`);
  for (let i = 0; i < protocols.length; i += 1) {
    if (protocols[i].toLowerCase() === config.wsSubprotocol.toLowerCase()) {
      return protocols[i]; // Accepts the connection and selects subprotocol
    }
  }
  return false; // Terminates the connection
};

// Internal Functions

/**
 * Executes a server start.
 *
 * Invoked on:
 *
 * - Call to tranport.start() with listening external http server or noServer mode
 * - Ws or http server listening event
 *
 * @memberof Server
 * @instance
 * @private
 * @returns {void}
 */
proto._start = function _start() {
  dbg("Starting the server");

  // Make sure the transport is starting
  // In external server mode, the start() function sometimes observes
  // server.listening === true before the listening event has fired,
  // which causes the transport to immediately become started
  if (this._state !== "starting") {
    dbg("Server is not starting - exiting");
    return; // Stop
  }

  // If in external server mode, monitor whether the server is still listening
  // Calls to httpServer.close() only trigger a http close event once all
  // WebSocket connections have disconnected, it does not force them closed
  if (this._options.server) {
    this._httpPollingInterval = setInterval(() => {
      dbg("Checking external http server listening status");
      if (this._options.server.listening) {
        dbg("External http server is still listening");
      } else {
        dbg("External http server is no longer listening");
        this._stop(
          new Error("FAILURE: The external http server stopped listening.")
        );
      }
    }, serverConfig.httpPollingMs);
  }

  // Update state and emit
  this._state = "started";
  this._emitAsync("start");
};

/**
 * Executes a server stoppage.
 *
 * Invoked on:
 *
 * - Call to transport.stop()
 * - Ws or external http server close event
 * - Ws or external http server error event
 *
 * @memberof Server
 * @instance
 * @private
 * @param {?Error} err
 * @returns {void}
 */
proto._stop = function _stop(err) {
  dbg("Stopping the server");

  // Do nothing if the transport is already stopping/stopped
  // Ws and external http servers emit both a close and an error event if
  // something goes wrong while already listening.
  if (this._state !== "starting" && this._state !== "started") {
    dbg("Server is not starting or started - exiting");
    return; // Stop
  }

  // Stop external http server status polling (if applicable)
  clearInterval(this._httpPollingInterval);
  this._httpPollingInterval = null;

  // Stop listening to all ws events (if applicable)
  _.each(this._wsClients, ws => {
    ws.removeAllListeners();
  });
  this._wsServer.removeAllListeners();

  // Stop listening to all external http server events (if applicable)
  if (this._httpHandlers) {
    ["listening", "close", "error"].forEach(evt => {
      this._options.server.removeListener(evt, this._httpHandlers[evt]);
    });
  }
  this._httpHandlers = null;

  // Stop any heartbeat intervals and timers
  _.each(this._heartbeatIntervals, intervalId => {
    clearInterval(intervalId);
  });
  _.each(this._heartbeatTimeouts, timeoutId => {
    clearTimeout(timeoutId);
  });
  this._heartbeatIntervals = {};
  this._heartbeatTimeouts = {};

  // Update transport state
  const wsServer = this._wsServer;
  const wsClients = this._wsClients;
  this._wsServer = null;
  this._wsClients = {};
  this._state = "stopping";

  // Close or terminate any outstanding WebSocket connections
  // In external http server mode a call to httpServer.close() does not force
  // WebSocket connections closed
  _.each(wsClients, ws => {
    if (err) {
      dbg("Terminating client connection");
      ws.terminate();
    } else {
      dbg("Closing client connection");
      ws.close(1000, "");
    }
  });

  // Emit any client disconnect events
  const disconnectErr = new Error("STOPPING: The server is stopping.");
  _.each(wsClients, (ws, cid) => {
    this._emitAsync("disconnect", cid, disconnectErr);
  });

  // Emit stopping
  if (err) {
    this._emitAsync("stopping", err);
  } else {
    this._emitAsync("stopping");
  }

  // Close the ws server if it's not already closed
  // Unfortunately the ws server has no readyState indicator
  // The ws server won't be closed on call to transport.stop() or if there is
  // a call to httpServer.close() in external server mode (listening polling fails)
  if (!err || this._options.server) {
    dbg("Closing ws server");
    wsServer.close(() => {
      // A callback is received from ws in all server modes
      dbg("Observed ws close callback");
      this._state = "stopped";
      if (err) {
        this._emitAsync("stop", err);
      } else {
        this._emitAsync("stop");
      }
    });
  } else {
    dbg("No need to close ws server, setting stopped");
    this._state = "stopped"; // Call to transport.start() is valid
    if (err) {
      this._emitAsync("stop", err);
    } else {
      this._emitAsync("stop");
    }
  }
};

/**
 * Executes a client disconnect.
 *
 * Invoked on:
 *
 *  - Call to transport.disconnect()
 *  - Ws client close event
 *  - Heartbeat timeout
 *  - Ws calls back error to ws.ping()
 *  - Ws calls back error to ws.send()
 *
 * @memberof Client
 * @instance
 * @private
 * @param {string} cid
 * @param {?Error} err
 * @returns {void}
 */
proto._disconnect = function _disconnect(cid, err) {
  dbg("Disconnecting a client");

  // Exit if the client has already been disconnected
  // Not clear whether ws.ping() and ws.send() fire close before calling back error
  if (!(cid in this._wsClients)) {
    dbg("Client already disconnected");
    return; // Stop
  }
  dbg("Client is still present");

  // Stop listening for ws client events
  this._wsClients[cid].removeAllListeners();

  // Clear any heartbeat interval/timeout
  clearInterval(this._heartbeatIntervals[cid]);
  clearTimeout(this._heartbeatTimeouts[cid]);
  delete this._heartbeatIntervals[cid];
  delete this._heartbeatTimeouts[cid];

  // Update the state
  const wsClient = this._wsClients[cid];
  delete this._wsClients[cid];

  // Close or terminate the ws connection if still open
  if (wsClient.readyState === wsClient.OPEN) {
    if (err) {
      dbg("Terminating client connection");
      wsClient.terminate();
    } else {
      dbg("Closing client connection");
      wsClient.close(1000, "");
    }
  } else {
    dbg("Client connection already closing or closed");
  }

  // Emit disconnect
  if (err) {
    this._emitAsync("disconnect", cid, err);
  } else {
    this._emitAsync("disconnect", cid);
  }
};

/**
 * Emits an event asynchronously during the next run around the event loop.
 *
 * The library only cares that events triggered by the library-facing API
 * (i.e. methods) are emitted asynchronously. But it is not clear whether ws
 * may in some cases call back or emit synchronously, so in order to ensure
 * a correct sequence of transport events, all are emitted asynchronously via
 * the nextTick queue.
 * @memberof Client
 * @instance
 * @private
 * @param {*} ...args
 * @returns {void}
 */
proto._emitAsync = function _emitAsync(...args) {
  dbg(`Scheduling asynchronous emission: ${args[0]}`);

  process.nextTick(() => {
    dbg(`Asynchronous emission: ${args[0]}`);
    this.emit(...args);
  });
};
