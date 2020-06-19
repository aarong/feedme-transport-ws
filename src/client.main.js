import emitter from "component-emitter";
import check from "check-types";
import debug from "debug";
import clientConfig from "./client.config";
import config from "./config";

const dbg = debug("feedme-transport-ws:client");

/**
 * Node.js client transport object.
 * @typedef {Object} Client
 * @extends emitter
 */

const proto = {};
emitter(proto);

/**
 * Node.js client factory function.
 *
 * The WebSocket constructor is injected to facilitate testing.
 *
 * WebSocket client objects cannot reconnect once disconnected, so a new
 * one is created for each connection attempt.
 *
 * WebSocket clients have a closing state and Feedme transports do not.
 * The transport discards closing WebSockets on calls to disconnect() and
 * then creates a new one if there is a quick call to connect(). This does
 * not result in a conflict as clients can have multiple connections on the
 * same port.
 * @param {Function} wsConstructor WebSocket client constructor
 * @param {string} address Endpoint address
 * @param {?Object} options Heartbeat settings and additional options for ws
 * @throws {Error} "INVALID_ARGUMENT: ..."
 * @returns {Client}
 */
export default function clientFactory(...args) {
  dbg("Initializing Client object");

  // Check wsConstructor
  if (!check.function(args[0])) {
    throw new Error("INVALID_ARGUMENT: Invalid wsConstructor argument.");
  }
  const wsConstructor = args[0];

  // Check address type
  if (!check.string(args[1])) {
    throw new Error("INVALID_ARGUMENT: Invalid address argument.");
  }
  const address = args[1];

  // Check address format (don't wait for ws initialization to fail)
  try {
    new URL(address); // eslint-disable-line no-new
  } catch (e) {
    throw new Error("INVALID_ARGUMENT: Invalid address argument.");
  }

  // Check options (if specified)
  let options;
  if (args.length > 2) {
    if (!check.object(args[2])) {
      throw new Error("INVALID_ARGUMENT: Invalid options argument.");
    }
    options = args[2]; // eslint-disable-line prefer-destructuring
  } else {
    options = {};
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
    options.heartbeatIntervalMs = clientConfig.defaults.heartbeatIntervalMs; // eslint-disable-line no-param-reassign
  }

  // Validate options.heartbeatTimeoutMs (if specified) and overlay default
  if ("heartbeatTimeoutMs" in options) {
    if (
      !check.integer(options.heartbeatTimeoutMs) ||
      options.heartbeatTimeoutMs <= 0 ||
      options.heartbeatTimeoutMs >= options.heartbeatIntervalMs // Will fail if heartbeat disabled
    ) {
      throw new Error(
        "INVALID_ARGUMENT: Invalid options.heartbeatTimeoutMs argument."
      );
    }
  } else {
    // If heartbeatIntervalMs === 0 (disabled) and heartbeatTimeoutMs is not specified,
    // then heartbeatTimeoutMs will be the default and thus greater than heartbeatIntervalMs,
    // but the option is not relevant
    options.heartbeatTimeoutMs = clientConfig.defaults.heartbeatTimeoutMs; // eslint-disable-line no-param-reassign
  }

  // Success

  const client = Object.create(proto);

  /**
   * WebSocket client constructor.
   * @memberof Client
   * @instance
   * @private
   * @type {Function}
   */
  client._wsConstructor = wsConstructor;

  /**
   * WebSocket client instance. Null if transport is disconnected.
   *
   * If a ws client exists then all event handlers are attached.
   * @memberof Client
   * @instance
   * @private
   * @type {?Object}
   */
  client._wsClient = null;

  /**
   * The outward-facing transport state. One of "disconnected", "connecting",
   * or "connected".
   * @memberof Client
   * @instance
   * @private
   * @type {string}
   */
  client._state = "disconnected";

  /**
   * Endpoint address passed to ws.
   * @memberof Client
   * @instance
   * @private
   * @type {string}
   */
  client._address = address;

  /**
   * Additional options passed to ws, plus heartbeat configuration.
   * @memberof Client
   * @instance
   * @private
   * @type {Object}
   */
  client._options = options;

  /**
   * Heartbeat interval id. Null if disabled or not connected.
   * @memberof Client
   * @instance
   * @private
   * @type {number}
   */
  client._heartbeatInterval = null;

  /**
   * Heartbeat timeout id. Null if heartbeat disabled or not connected or not awaiting pong.
   * @memberof Client
   * @instance
   * @private
   * @type {number}
   */
  client._heartbeatTimeout = null;

  return client;
}

// Events

/**
 * @event connecting
 * @memberof Client
 * @instance
 */

/**
 * @event connect
 * @memberof Client
 * @instance
 */

/**
 * @event message
 * @memberof Client
 * @instance
 * @param {string} msg
 */

/**
 * @event disconnect
 * @memberof Client
 * @instance
 * @param {?Error} err "FAILURE: ..." if not due to call to client.disconnect()
 */

// Public API

/**
 * Returns the transport state: "disconnected", "connecting", or "connected".
 * @memberof Client
 * @instance
 * @returns {string}
 */
proto.state = function state() {
  dbg("State requested");

  return this._state;
};

/**
 * The library wants the transport to connect.
 * @memberof Client
 * @instance
 * @throws {Error} "INVALID_STATE: ..."
 * @returns {void}
 */
proto.connect = function connect() {
  dbg("Connect requested");

  // Check state - is this a valid call on the transport?
  if (this._state !== "disconnected") {
    throw new Error("INVALID_STATE: Already connecting or connected.");
  }

  // Update state and emit asynchronously
  this._state = "connecting";
  this._emitAsync("connecting");

  // Try to create the WebSocket client
  try {
    this._wsClient = new this._wsConstructor(
      this._address,
      config.wsSubprotocol,
      this._options
    );
  } catch (e) {
    dbg("Failed to initialize ws client");

    // Update state and emit disconnect asynchronously
    this._state = "disconnected";
    const err = new Error(
      "FAILURE: Could not initialize the WebSocket client."
    );
    err.wsError = e;
    this._emitAsync("disconnect", err);
    return; // Stop
  }

  // Listen for events
  this._wsClient.on("open", this._processWsOpen.bind(this));
  this._wsClient.on("message", this._processWsMessage.bind(this));
  this._wsClient.on("pong", this._processWsPong.bind(this));
  this._wsClient.on("close", this._processWsClose.bind(this));
  this._wsClient.on("error", this._processWsError.bind(this));
};

/**
 * The library wants the transport to disconnect. The transport could be
 * connecting or connected.
 * @memberof Client
 * @instance
 * @param {?Error} err
 * @throws {Error} "INVALID_STATE: ..."
 * @throws {Error} "INVALID_ARGUMENT: ..."
 * @returns {void}
 */
proto.disconnect = function disconnect(...args) {
  dbg("Disconnect requested");

  // Check err (if specified)
  let err;
  if (args.length > 0) {
    [err] = args;
    if (!check.instance(err, Error)) {
      throw new Error("INVALID_ARGUMENT: Invalid error argument.");
    }
  }

  // Check state - is this a valid call on the transport?
  if (this._state === "disconnected") {
    throw new Error("INVALID_STATE: Already disconnected.");
  }

  // Success

  this._disconnect(err);
};

/**
 * The library wants to send a message to the server.
 * @memberof Client
 * @instance
 * @param {string} msg
 * @throws {Error} "INVALID_STATE: ..."
 * @throws {Error} "INVALID_ARGUMENT: ..."
 * @returns {void}
 */
proto.send = function send(msg) {
  dbg("Send requested");

  // Check message
  if (!check.string(msg)) {
    throw new Error("INVALID_ARGUMENT: Invalid message.");
  }

  // Check state - is this a valid call on the transport?
  if (this._state !== "connected") {
    throw new Error("INVALID_STATE: Not connected.");
  }

  // Try to send the message
  this._wsClient.send(msg, err => {
    // The message has been written or has failed to write
    if (err) {
      dbg("Error writing message");
      const transportErr = new Error("FAILURE: WebSocket transmission failed.");
      transportErr.wsError = err;
      this._disconnect(transportErr);
    } else {
      dbg("Message written successfully");
    }
  });
};

// WebSocket event handlers

/**
 * Processes a ws open event.
 * @memberof Client
 * @instance
 * @private
 * @returns {void}
 */
proto._processWsOpen = function _processWsOpen() {
  dbg("Observed ws open event");

  // Set up the heartbeat (if so configured)
  if (this._options.heartbeatIntervalMs > 0) {
    dbg("Starting heartbeat interval");
    this._heartbeatInterval = setInterval(() => {
      dbg("Sending ping and starting heartbeat timeout");

      // Start the heartbeat timeout
      // Cleared on pong receipt and on disconnect, so if fired you know you need to terminate
      this._heartbeatTimeout = setTimeout(() => {
        dbg("Heartbeat timed out");
        this._disconnect(new Error("FAILURE: The WebSocket heartbeat failed."));
      }, this._options.heartbeatTimeoutMs);

      // Ping the server - ws automatically replies with pong
      this._wsClient.ping(err => {
        // The ping frame has been written or has failed to write - pong not yet received
        if (err) {
          dbg("Error writing ping frame");
          const transportErr = new Error(
            "FAILURE: The WebSocket heartbeat failed."
          );
          transportErr.wsError = err;
          this._disconnect(transportErr);
        } else {
          dbg("Ping frame written successfully");
        }
      });
    }, this._options.heartbeatIntervalMs);
  }

  // Update state and emit
  this._state = "connected";
  this._emitAsync("connect");
};

/**
 * Processes a ws message event.
 * @memberof Client
 * @instance
 * @private
 * @param {*} msg
 * @returns {void}
 */
proto._processWsMessage = function _processWsMessage(data) {
  dbg("Observed ws message event");

  // Check data type - could be String, Buffer, ArrayBuffer, Buffer[]
  if (!check.string(data)) {
    dbg("Unexpected WebSocket message type");
    dbg(data);
    this._disconnect(
      new Error("FAILURE: Received non-string message on WebSocket connection.")
    );
    return; // Stop
  }

  this._emitAsync("message", data);
};

/**
 * Processes a ws pong event.
 * @memberof Client
 * @instance
 * @private
 * @returns {void}
 */
proto._processWsPong = function _processWsPong() {
  dbg("Observed ws pong event");

  // Clear the heartbeat timeout
  clearTimeout(this._heartbeatTimeout);
  this._heartbeatTimeout = null;
};

/**
 * Processes a ws close event.
 *
 * All ws listeners are removed by _disconnect(), so this function is only
 * called if there is an unexpected connection closure.
 * @memberof Client
 * @instance
 * @private
 * @param {?number} code
 * @param {?string} reason
 * @returns {void}
 */
proto._processWsClose = function _processWsClose(code, reason) {
  dbg("Observed ws close event");

  const errMsg =
    this._state === "connecting"
      ? "FAILURE: The WebSocket could not be opened."
      : "FAILURE: The WebSocket closed unexpectedly.";
  const err = new Error(errMsg);
  err.wsCode = code;
  err.wsReason = reason;
  this._disconnect(err);
};

/**
 * Processes a ws error event.
 * The WebSocket client also fires a close event when an error occurs.
 * This handler prevents unhandled error events and helps debugging.
 * @memberof Client
 * @instance
 * @private
 * @param {?number} code
 * @param {?string} reason
 * @returns {void}
 */
proto._processWsError = function _processWsError(err) {
  dbg("Observed ws error event");
  dbg(err);
};

// Internal Functions

/**
 * Disconnect the transport client.
 *
 *  - Call to transport.disconnect()
 *  - Unexpected connection closure
 *  - Heartbeat timeout
 *  - Ws calls back error to ws.ping()
 *  - Ws calls back error to ws.send()
 *
 * Resets the state, emits, and closes the ws connection as appropriate.
 * @memberof Client
 * @instance
 * @private
 * @param {Error} err
 * @returns {void}
 */
proto._disconnect = function _disconnect(err) {
  dbg("Disconnecting the client");

  // Remove all ws listeners (if present)
  if (this._wsClient) {
    this._wsClient.removeAllListeners();
  }

  // Clear heartbeat (if any)
  clearInterval(this._heartbeatInterval);
  this._heartbeatInterval = null;
  clearTimeout(this._heartbeatTimeout);
  this._heartbeatTimeout = null;

  // Remove the ws client reference
  const wsClient = this._wsClient;
  this._wsClient = null;

  // Close the ws connection (if any)
  if (wsClient) {
    const close = () => {
      if (err) {
        dbg("Terminating client connection");
        wsClient.terminate();
      } else {
        dbg("Closing client connection");
        wsClient.close(1000);
      }
    };
    if (wsClient.readyState === wsClient.OPEN) {
      // The ws instance is open - close it
      dbg("The ws connection is open");
      close();
    } else if (wsClient.readyState === wsClient.CONNECTING) {
      // The ws instance is opening - close it if it opens
      dbg("The ws connection is opening");
      wsClient.once("open", close);
    }
  }

  // Update state and emit asynchronously
  if (this._state !== "disconnected") {
    this._state = "disconnected";
    if (err) {
      this._emitAsync("disconnect", err);
    } else {
      this._emitAsync("disconnect");
    }
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
