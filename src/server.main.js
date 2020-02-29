import emitter from "component-emitter";
import uuid from "uuid";
import debug from "debug";
import check from "check-types";
import _ from "lodash";
import config from "./server.config";

const dbg = debug("feedme-transport-ws:server");

/**
 * Server transport object.
 *
 * The ws module does not provide a way to reuse a server object once closed,
 * so a new one is initialized for each start/stop cycle. The WebSocket.server
 * constructor is injected to facilitate testing.
 * @typedef {Object} Server
 * @extends emitter
 */

const proto = {};
emitter(proto);

/**
 * Server factory function.
 * @param {Function} wsConstructor WebSocket.server constuctor
 * @param {Object} options Options for WebSocket.server plus transport heartbeat config
 * @throws {Error} "INVALID_ARGUMENT: ..."
 * @returns {Server}
 */
export default function serverFactory(wsConstructor, options) {
  dbg("Initializing Server object");

  // Validate wssConstructor
  if (!check.function(wsConstructor)) {
    throw new Error("INVALID_ARGUMENT: Invalid wsConstructor argument.");
  }

  // Validate options
  if (!check.object(options)) {
    throw new Error("INVALID_ARGUMENT: Invalid options argument.");
  }

  // Validate core ws options - leave the rest to ws
  if (
    "port" in options &&
    (!check.integer(options.port) || options.port < 0 || options.port > 65535)
  ) {
    throw new Error("INVALID_ARGUMENT: Invalid options.port argument.");
  }
  if ("server" in options && !check.object(options.server)) {
    throw new Error("INVALID_ARGUMENT: Invalid options.server argument.");
  }
  if ("noServer" in options && !check.boolean(options.noServer)) {
    throw new Error("INVALID_ARGUMENT: Invalid options.noServer argument.");
  }
  if (
    !("port" in options) &&
    !("server" in options) &&
    !("noServer" in options)
  ) {
    throw new Error(
      "INVALID_ARGUMENT: Must specify a valid port, server, or noServer option."
    );
  }

  // Validate options.heartbeatIntervalMs (if specified) and overlay default
  if ("heartbeatIntervalMs" in options) {
    if (
      !check.integer(options.heartbeatIntervalMs) ||
      options.heartbeatIntervalMs < 0
    ) {
      throw new Error(
        "INVALID_ARGUMENT: Invalid options.heartbeatIntervalMs argument."
      );
    }
  } else {
    options.heartbeatIntervalMs = config.defaults.heartbeatIntervalMs; // eslint-disable-line no-param-reassign
  }

  // Validate options.heartbeatTimeoutMs (if specified) and overlay default
  if ("heartbeatTimeoutMs" in options) {
    if (
      !check.integer(options.heartbeatTimeoutMs) ||
      options.heartbeatTimeoutMs <= 0 ||
      options.heartbeatTimeoutMs >= options.heartbeatIntervalMs
    ) {
      throw new Error(
        "INVALID_ARGUMENT: Invalid options.heartbeatTimeoutMs argument."
      );
    }
  } else {
    options.heartbeatTimeoutMs = config.defaults.heartbeatTimeoutMs; // eslint-disable-line no-param-reassign
  }

  // Success
  const server = Object.create(proto);

  /**
   * WebSocket.server constructor function. Injected to facilitate unit tests.
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
   * this._heartbeatTimeouts[clientId] = timeout id or missing if not awaiting pong or heartbeats disabled
   *
   * @memberof Server
   * @instance
   * @private
   * @type {Object}
   */
  server._heartbeatTimeouts = {};

  /**
   * Options for WebSocket.server().
   * @memberof Server
   * @instance
   * @private
   * @type {Object}
   */
  server._options = options;

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
 *                      Not present if due to call to server.disconnect()
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

  // Set state to starting
  this._state = "starting";

  // Wait until the next tick before emitting events
  setTimeout(() => {
    dbg("Emitting starting and initializing ws");

    // Emit starting
    this.emit("starting");

    // Create the ws server
    try {
      // Passes the two extraneous heartbeat options, which are ignored by ws
      this._wsServer = new this._wsConstructor(this._options);
    } catch (e) {
      // Emit stopping, emit stop, then stop
      const err = new Error("FAILURE: Could not initialize WebSocket server.");
      err.wsError = e;
      this._state = "stopping";
      this.emit("stopping", err);
      this._state = "stopped";
      this.emit("stop", err);
      return; // Stop
    }

    // Listen for ws events
    this._wsServer.on("listening", this._processWsServerListening.bind(this));
    this._wsServer.on("close", this._processWsServerClose.bind(this));
    this._wsServer.on("connection", this._processWsServerConnection.bind(this));
  }, 0);
};

/**
 * Stops the server.
 *
 * Does not rely on the "stop" event fired by the ws module, because that event
 * does not know whether the stoppage was requested by a call to server.stop()
 * or from a ws problem.
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

  // Stop listening to all ws events
  _.each(this._wsClients, ws => {
    ws.removeAllListeners("message");
    ws.removeAllListeners("pong");
    ws.removeAllListeners("close");
  });
  this._wsServer.removeAllListeners("listening");
  this._wsServer.removeAllListeners("close");
  this._wsServer.removeAllListeners("connection");

  // Stop all heartbeat intervals and timers
  _.each(this._heartbeatIntervals, intervalId => {
    clearInterval(intervalId);
  });
  _.each(this._heartbeatTimeouts, timeoutId => {
    clearTimeout(timeoutId);
  });

  // Save some references and update state
  const wsServer = this._wsServer;
  const clients = this._wsClients;
  this._wsServer = null;
  this._state = "stopping";
  this._wsClients = {};
  this._heartbeatIntervals = {};
  this._heartbeatTimeouts = {};

  // Stop the ws server - callback is on a later tick
  // The stopping and stop event are emitted together because you need to run
  // ws.close() synchronously to prevent it from emitting further events, and
  // you aren't allowed to emit the "stopping" event synchronously.
  wsServer.close(() => {
    dbg("Emitting disconnect(s) and stopping, then closing ws server");

    // Emit a disconnect event for each previously-connected client
    _.each(clients, (ws, cid) => {
      this.emit(
        "disconnect",
        cid,
        new Error("STOPPING: The server is stopping.")
      );
    });

    // Emit
    this.emit("stopping");
    this._state = "stopped";
    this.emit("stop");
  });
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

  // Send the message
  this._wsClients[cid].send(msg);
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

  // Stop listening to client ws events
  this._wsClients[cid].removeAllListeners("message");
  this._wsClients[cid].removeAllListeners("pong");
  this._wsClients[cid].removeAllListeners("close");

  // Clear heartbeat interval/timeout
  clearInterval(this._heartbeatIntervals[cid]);
  if (this._heartbeatTimeouts[cid]) {
    clearTimeout(this._heartbeatTimeouts[cid]);
  }

  // Update transport state
  const wsClient = this._wsClients[cid];
  delete this._wsClients[cid];
  delete this._heartbeatIntervals[cid];
  delete this._heartbeatTimeouts[cid];

  // Disconnect the client (normal status)
  wsClient.close(1000, "Connection closed by the server.");

  // Emit disconnect on next tick (with err if present)
  setTimeout(() => {
    dbg("Emitting disconnect");

    if (err) {
      this.emit("disconnect", cid, err);
    } else {
      this.emit("disconnect", cid);
    }
  }, 0);
};

/**
 * Processes a ws server "listening" event.
 * @memberof Server
 * @instance
 * @private
 * @returns {void}
 */
proto._processWsServerListening = function _processWsServerListening() {
  dbg("Observed ws listening event");

  this._state = "started";
  this.emit("start");
};

/**
 * Processes a ws server "close" event.
 *
 * The server.stop() method removes all ws event listeners, so this function
 * is called only when the server stops unexpectedly.
 *
 * The server state may have been "starting" or "started" but both cases are
 * handled the same way.
 * @memberof Server
 * @instance
 * @private
 * @returns {void}
 */
proto._processWsServerClose = function _processWsServerClose() {
  dbg("Observed ws close event");

  // Stop listening to all ws events
  _.each(this._wsClients, ws => {
    ws.removeAllListeners("message");
    ws.removeAllListeners("pong");
    ws.removeAllListeners("close");
  });
  this._wsServer.removeAllListeners("listening");
  this._wsServer.removeAllListeners("close");
  this._wsServer.removeAllListeners("connection");

  // Stop all heartbeat intervals and timers
  _.each(this._heartbeatIntervals, intervalId => {
    clearInterval(intervalId);
  });
  _.each(this._heartbeatTimeouts, timeoutId => {
    clearTimeout(timeoutId);
  });

  // Update transport state
  const clients = this._wsClients;
  this._wsServer = null;
  this._state = "stopping";
  this._wsClients = {};
  this._heartbeatIntervals = {};
  this._heartbeatTimeouts = {};

  // Emit client disconnect events
  _.each(clients, (ws, cid) => {
    this.emit(
      "disconnect",
      cid,
      new Error("STOPPING: The server is stopping.")
    );
  });

  // Emit stopping and stop
  this.emit(
    "stopping",
    new Error("FAILURE: The WebSocket server stopped unexpectedly.")
  );
  this._state = "stopped";
  this.emit(
    "stop",
    new Error("FAILURE: The WebSocket server stopped unexpectedly.")
  );
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

  // Assign an id and store the ws client
  const cid = uuid();
  this._wsClients[cid] = ws;

  // Set heartbeat status and start the heartbeat interval (if so configured)
  if (this._options.heartbeatIntervalMs > 0) {
    this._heartbeatIntervals[cid] = setInterval(() => {
      dbg("Starting heartbeat timeout");

      // Start the heartbeat timeout
      // Timeout is cleared on pong receipt and on client disconnect
      this._heartbeatTimeouts[cid] = setTimeout(() => {
        dbg("Heartbeat timed out");
        this._wsClients[cid].terminate(); // Triggers a client "close" event
      }, this._options.heartbeatTimeoutMs);

      // Ping the client
      // The ws module automatically responds to pings with pongs
      this._wsClients[cid].ping(err => {
        // The ping frame has been written or has failed to write
        // At this point, the client may have actually disconnected
        if (err && this._wsClients[cid]) {
          this._wsClients[cid].terminate(); // Triggers a ws client "close" event
        }
      });
    }, this._options.heartbeatIntervalMs);
  }

  // Listen for ws client events
  ws.on("message", msg => {
    this._processWsClientMessage(cid, msg);
  });
  ws.on("pong", () => {
    this._processWsClientPong(cid);
  });
  ws.on("close", (code, reason) => {
    this._processWsClientClose(cid, code, reason);
  });

  // Emit transport connect
  this.emit("connect", cid);
};

/**
 * Processes a ws client "message" event.
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

  this.emit("message", cid, msg);
};

/**
 * Processes a ws client "pong" event.
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
 * Processes a ws client "close" event.
 *
 * The client "close" event is fired by ws...
 * - On server stoppage after the server-level close event
 * - On server call to ws.close() or ws.terminate()
 * - On client call to ws.close() or ws.terminate()
 *
 * The server.disconnect() method removes client ws event listeners and the
 * server.stop() method removes all ws event listeners, so this function is
 * called only when a single client disconnects unexpectedly. This includes
 * regular disconnects and heartbeat failures, which call ws.terminate() and
 * trigger a ws "close" event.
 *
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

  // Stop listening for client events
  this._wsClients[cid].removeAllListeners("message");
  this._wsClients[cid].removeAllListeners("pong");
  this._wsClients[cid].removeAllListeners("close");

  // Clear any heartbeat interval/timer
  if (this._heartbeatIntervals[cid]) {
    clearInterval(this._heartbeatIntervals[cid]);
  }
  if (this._heartbeatTimeouts[cid]) {
    clearTimeout(this._heartbeatTimeouts[cid]);
  }

  // Update the state
  delete this._wsClients[cid];
  delete this._heartbeatIntervals[cid];
  delete this._heartbeatTimeouts[cid];

  // Emit disconnect
  const err = new Error("FAILURE: The WebSocket closed.");
  err.wsCode = code;
  err.wsReason = reason;
  this.emit("disconnect", cid, err);
};
