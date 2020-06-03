import emitter from "component-emitter";
import check from "check-types";
import debug from "debug";
import config from "./client.config";

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
 * WebSocket client objects cannot reconnect once disconnected, so a new
 * one is created for each connection attempt.
 *
 * WebSocket clients have a closing state and Feedme transports do not, so
 * the former is subsumed into the transport connecting state if there is a
 * quick sequence of calls to transport.disconnect() and transport.connect().
 * @param {Function} wsConstructor WebSocket client constructor
 * @param {string} address Endpoint address for ws
 * @param {?string|Array} protocols Protocols for ws
 * @param {?Object} options Additional options for ws
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

  // Check address format (don't wait until ws initialization to fail)
  try {
    new URL(address); // eslint-disable-line no-new
  } catch (e) {
    throw new Error("INVALID_ARGUMENT: Invalid address argument.");
  }

  // Check protocols (if specified)
  let protocols;
  if (args.length > 2) {
    if (!check.string(args[2]) && !check.array(args[2])) {
      throw new Error("INVALID_ARGUMENT: Invalid protocols argument.");
    }
    if (check.array(args[2])) {
      args[2].forEach(protocol => {
        if (!check.string(protocol)) {
          throw new Error("INVALID_ARGUMENT: Invalid protocols argument.");
        }
      });
    }
    protocols = args[2]; // eslint-disable-line prefer-destructuring
  } else {
    protocols = "";
  }

  // Check options (if specified)
  let options;
  if (args.length > 3) {
    if (!check.object(args[3])) {
      throw new Error("INVALID_ARGUMENT: Invalid options argument.");
    }
    options = args[3]; // eslint-disable-line prefer-destructuring
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
    options.heartbeatIntervalMs = config.defaults.heartbeatIntervalMs; // eslint-disable-line no-param-reassign
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
    options.heartbeatTimeoutMs = config.defaults.heartbeatTimeoutMs; // eslint-disable-line no-param-reassign
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
   * WebSocket client instance.
   *
   * If the previous ws connection finished closing, or there never was one, then
   * this is null. Otherwise, this is the ws instance.
   *
   * If a ws client exists then all event handlers are attached.
   * @memberof Client
   * @instance
   * @private
   * @type {?Object}
   */
  client._wsClient = null;

  /**
   * The previous WebSocket client state. Null if there is no ws client, otherwise
   * "connecting", "connected", or "disconnecting".
   *
   * Needed because when there is a ws close event, you need to know whether it
   * was because (1) a previous call to ws.close() completed successfully, in
   * which case if the transport state is connecting you will attempt to
   * reconnect, or (2) an attempt to initiate a connection failed , in which case
   * if the transport state is connecting you will emit disconnect.
   * @memberof Client
   * @instance
   * @private
   * @type {?string}
   */
  client._wsPreviousState = null;

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
   * Protocols passed to ws.
   * @memberof Client
   * @instance
   * @private
   * @type {string|Array}
   */
  client._protocols = protocols;

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
 * @param {?Error} err "DISCONNECTED: ..." if not due to call to client.disconnect()
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
 * The ws client state could be anything except connected.
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

  // If the ws client is disconnected then start connecting, otherwise wait for ws event
  if (!this._wsClient) {
    dbg("Initializing ws client");

    // Try to create the WebSocket client and emit disconnect asynchronously if constructor throws
    try {
      this._wsClient = new this._wsConstructor(
        this._address,
        this._protocols,
        this._options
      );
    } catch (e) {
      dbg("Failed to initialize ws client");
      const err = new Error(
        "DISCONNECTED: Could not initialize the WebSocket client."
      );
      err.wsError = e;
      this._state = "disconnected";
      this._emitAsync("disconnect", err);
      return; // Stop
    }

    // Update state
    this._wsPreviousState = "connecting";

    // Listen for events
    this._wsClient.on("open", this._processWsOpen.bind(this));
    this._wsClient.on("message", this._processWsMessage.bind(this));
    this._wsClient.on("pong", this._processWsPong.bind(this));
    this._wsClient.on("close", this._processWsClose.bind(this));
    this._wsClient.on("error", this._processWsError.bind(this));
  }
};

/**
 * The library wants the transport to disconnect.
 * The ws client state could be anything except disconnected.
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

  // Clear heartbeat (if any)
  if (this._heartbeatInterval) {
    clearInterval(this._heartbeatInterval);
    this._heartbeatInterval = null;
  }
  if (this._heartbeatTimeout) {
    clearTimeout(this._heartbeatTimeout);
    this._heartbeatTimeout = null;
  }

  // Close the ws connection if it's open, otherwise wait for ws event
  if (this._wsClient.readyState === this._wsClient.OPEN) {
    this._wsClient.close(1000, "Connection closed by the client.");
    this._wsPreviousState = "disconnecting";
  }

  // Update state and emit disconnect asynchronously
  this._state = "disconnected";
  if (err) {
    this._emitAsync("disconnect", err);
  } else {
    this._emitAsync("disconnect");
  }
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
      this._connectionFailure(transportErr);
    } else {
      dbg("Message written successfully");
    }
  });
};

// WebSocket event handlers

/**
 * Processes a ws open event.
 * The outward-facing transport state could be disconnected or connecting.
 * @memberof Client
 * @instance
 * @private
 * @returns {void}
 */
proto._processWsOpen = function _processWsOpen() {
  dbg("Observed ws open event");

  if (this._state === "disconnected") {
    // The transport is disconnected - there was a call to connect() and
    // then disconnect() or some sequence of that pair
    dbg("Transport was disconnected");

    this._wsPreviousState = "disconnecting";
    this._wsClient.close(1000, "Connection closed by the client.");
  } else {
    // The transport is connecting - standard case
    dbg("Transport was connecting");

    // Set up the heartbeat (if so configured)
    if (this._options.heartbeatIntervalMs > 0) {
      dbg("Starting heartbeat interval");
      this._heartbeatInterval = setInterval(() => {
        dbg("Sending ping and starting heartbeat timeout");

        // Start the heartbeat timeout
        // Cleared on pong receipt and on disconnect, so if fired you know you need to terminate
        this._heartbeatTimeout = setTimeout(() => {
          dbg("Heartbeat timed out");
          this._connectionFailure(
            new Error("FAILURE: The WebSocket heartbeat failed.")
          );
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
            this._connectionFailure(transportErr);
          } else {
            dbg("Ping frame written successfully");
          }
        });
      }, this._options.heartbeatIntervalMs);
    }

    // Update state and emit
    this._wsPreviousState = "connected";
    this._state = "connected";
    this._emitAsync("connect");
  }
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
    this.disconnect(
      new Error(
        "DISCONNECTED: Received invalid message type on WebSocket connection."
      )
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
 * The ws client will emit a close event if the initial connection could not
 * be established, if an open connection is closed normally, and if an open
 * connection fails due to an error.
 * @memberof Client
 * @instance
 * @private
 * @param {?number} code
 * @param {?string} reason
 * @returns {void}
 */
proto._processWsClose = function _processWsClose(code, reason) {
  dbg("Observed ws close event");

  // Remove all ws listeners
  this._wsClient.removeAllListeners();

  // Clear heartbeat (if any)
  if (this._heartbeatInterval) {
    clearInterval(this._heartbeatInterval);
    this._heartbeatInterval = null;
  }
  if (this._heartbeatTimeout) {
    clearTimeout(this._heartbeatTimeout);
    this._heartbeatTimeout = null;
  }

  if (this._state === "disconnected") {
    // There was a call to transport.disconnect() or the heartbeat failed or
    // a call to ws.send() threw an exception.
    // The disconnect event has already been emitted and the heartbeat timers
    // cleared, and the library still wants the transport disconnected
    dbg("Transport state was disconnected");
    this._wsClient = null;
    this._wsPreviousState = null;
  } else if (
    this._state === "connecting" &&
    this._wsPreviousState === "disconnecting"
  ) {
    dbg("Transport state was connecting and ws was disconnecting");
    // There was a call to transport.connect() when ws was disconnecting due to
    // a call to transport.disconnect(). The connecting event has already been
    // fired, so just try to establish a new ws connection

    // Try to create the WebSocket client and emit disconnect if constructor throws
    try {
      this._wsClient = new this._wsConstructor(
        this._address,
        this._protocols,
        this._options
      );
    } catch (e) {
      dbg("Ws initialization failed");
      this._wsClient = null; // Otherwise it will be the previous client
      this._wsPreviousState = null;
      this._state = "disconnected";
      const err = new Error(
        "DISCONNECTED: Could not initialize the WebSocket client."
      );
      err.wsError = e;
      this._emitAsync("disconnect", err);
      return; // Stop
    }

    // Update state
    this._wsPreviousState = "connecting";

    // Listen for events
    this._wsClient.on("open", this._processWsOpen.bind(this));
    this._wsClient.on("message", this._processWsMessage.bind(this));
    this._wsClient.on("pong", this._processWsPong.bind(this));
    this._wsClient.on("close", this._processWsClose.bind(this));
    this._wsClient.on("error", this._processWsError.bind(this));
  } else {
    // The transport connection failed unexpectedly. The transport state could
    // be connecting or connected, but either way you emit disconnect
    dbg("Transport connection failed unexpectedly");
    const errMsg =
      this._state === "connecting"
        ? "DISCONNECTED: The WebSocket could not be opened."
        : "DISCONNECTED: The WebSocket closed unexpectedly.";
    this._wsClient = null;
    this._wsPreviousState = null;
    this._state = "disconnected";
    const err = new Error(errMsg);
    err.wsCode = code;
    err.wsReason = reason;
    this._emitAsync("disconnect", err);
  }
};

/**
 * Processes a ws error event.
 * The WebSocket client also fires a close event when an error occurs, so
 * this is for debugging purposes only.
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
 * Handles an abnormal connection failure:
 *
 *  - Heartbeat timeout
 *  - Ws calls back error to ws.ping()
 *  - Ws calls back error to ws.send()
 *
 * Resets the state, emits, and terminates the ws connection as appropriate.
 *
 * Unsure whether ws.ping() and ws.send() trigger close events when calling back
 * error, but it doesn't matter.
 * @memberof Client
 * @instance
 * @private
 * @param {Error} err
 * @returns {void}
 */
proto._connectionFailure = function _connectionFailure(err) {
  dbg("Connection failed");

  // Clear heartbeat (if any)
  if (this._heartbeatInterval) {
    clearInterval(this._heartbeatInterval);
    this._heartbeatInterval = null;
  }
  if (this._heartbeatTimeout) {
    clearTimeout(this._heartbeatTimeout);
    this._heartbeatTimeout = null;
  }

  // Terminate the ws connection if it's still open
  // Triggers a ws close event asynchronously, which resets _wsClient and _wsPreviousState
  if (this._wsClient && this._wsClient.readyState === this._wsClient.OPEN) {
    this._wsClient.terminate();
    this._wsPreviousState = "disconnecting";
  }

  // Update state and emit
  if (this._state !== "disconnected") {
    this._state = "disconnected";
    this._emitAsync("disconnect", err);
  }
};

/**
 * Emits an event asynchronously during the next run around the event loop
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
