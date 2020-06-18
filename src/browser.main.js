import emitter from "component-emitter";
import check from "check-types";
import debug from "debug";
import config from "./config";

const dbg = debug("feedme-transport-ws:browser");

/**
 * Browser client transport object.
 * @typedef {Object} Browser
 * @extends emitter
 */

const proto = {};
emitter(proto);

/**
 * Browser client factory function.
 *
 * WebSocket client objects cannot reconnect once disconnected, so a new
 * one is created for each connection attempt.
 *
 * WebSocket clients have a closing state and Feedme transports do not, so
 * the former is subsumed into the transport connecting state if there is a
 * quick sequence of calls to transport.disconnect() and transport.connect().
 * @param {Function} wsConstructor WebSocket client constructor
 * @param {string} address Endpoint address for WebSocket
 * @throws {Error} "INVALID_ARGUMENT: ..."
 * @returns {Browser}
 */
export default function browserFactory(...args) {
  dbg("Initializing Browser object");

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
    const err = new Error("INVALID_ARGUMENT: Invalid address argument.");
    err.urlError = e;
    throw err;
  }

  // Success

  const browser = Object.create(proto);

  /**
   * WebSocket client constructor.
   * @memberof Browser
   * @instance
   * @private
   * @type {Function}
   */
  browser._wsConstructor = wsConstructor;

  /**
   * WebSocket client instance.
   *
   * If the previous ws connection finished closing, or there never was one, then
   * this is null. Otherwise, this is the ws instance.
   *
   * If a ws client exists then all event handlers are attached.
   * @memberof Browser
   * @instance
   * @private
   * @type {?Object}
   */
  browser._wsClient = null;

  /**
   * The previous WebSocket client state. Null if there is no ws client, otherwise
   * "connecting", "connected", or "disconnecting".
   *
   * Needed because when there is a ws close event, you need to know whether it
   * was because (1) a previous call to ws.close() completed successfully, in
   * which case if the transport state is connecting you will attempt to
   * reconnect, or (2) an attempt to initiate a connection failed , in which case
   * if the transport state is connecting you will emit disconnect.
   * @memberof Browser
   * @instance
   * @private
   * @type {?string}
   */
  browser._wsPreviousState = null;

  /**
   * The outward-facing transport state. One of "disconnected", "connecting",
   * or "connected".
   * @memberof Browser
   * @instance
   * @private
   * @type {string}
   */
  browser._state = "disconnected";

  /**
   * Endpoint address passed to ws.
   * @memberof Browser
   * @instance
   * @private
   * @type {string}
   */
  browser._address = address;

  return browser;
}

// Events

/**
 * @event connecting
 * @memberof Browser
 * @instance
 */

/**
 * @event connect
 * @memberof Browser
 * @instance
 */

/**
 * @event message
 * @memberof Browser
 * @instance
 * @param {string} msg
 */

/**
 * @event disconnect
 * @memberof Browser
 * @instance
 * @param {?Error} err "FAILURE: ..." if not due to call to browser.disconnect()
 */

// Public API

/**
 * Returns the transport state: "disconnected", "connecting", or "connected".
 * @memberof Browser
 * @instance
 * @returns {string}
 */
proto.state = function state() {
  dbg("State requested");

  return this._state;
};

/**
 * The library wants the transport to connect.
 * The WebSocket client state could be anything except connected.
 * @memberof Browser
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
    this._connect();
  }
};

/**
 * The library wants the transport to disconnect.
 * The ws client state could be anything except disconnected.
 * @memberof Browser
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
 * @memberof Browser
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
  try {
    this._wsClient.send(msg);
  } catch (e) {
    dbg("Error writing message");
    const transportErr = new Error("FAILURE: WebSocket transmission failed.");
    transportErr.wsError = e;
    this._disconnect(transportErr);
  }
  dbg("Message written successfully");
};

// WebSocket event handlers

/**
 * Processes a ws open event.
 * The outward-facing transport state could be disconnected or connecting.
 * @memberof Browser
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

    // Update state and emit
    this._wsPreviousState = "connected";
    this._state = "connected";
    this._emitAsync("connect");
  }
};

/**
 * Processes a ws message event.
 * @memberof Browser
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
      new Error("FAILURE: Received non-string message on WebSocket connection.")
    );
    return; // Stop
  }

  this._emitAsync("message", data);
};

/**
 * Processes a ws close event.
 *
 * The WebSocket client will emit a close event if
 *
 *  - The initial connection could not be established
 *  - An open connection is closed normally
 *  - An open connection fails due to an error.
 * @memberof Browser
 * @instance
 * @private
 * @param {?number} code
 * @param {?string} reason
 * @returns {void}
 */
proto._processWsClose = function _processWsClose(code, reason) {
  dbg("Observed ws close event");

  // Remove all ws listeners
  this._wsClient.onopen = null;
  this._wsClient.onmessage = null;
  this._wsClient.onclose = null;
  this._wsClient.onerror = null;

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

    this._connect();
  } else {
    // The transport connection failed unexpectedly. The transport state could
    // be connecting or connected, but either way you emit disconnect
    dbg("Transport connection failed unexpectedly");

    // Emit disconnect asynchronously
    const errMsg =
      this._state === "connecting"
        ? "FAILURE: The WebSocket could not be opened."
        : "FAILURE: The WebSocket closed unexpectedly.";
    const err = new Error(errMsg);
    err.wsCode = code;
    err.wsReason = reason;
    this._emitAsync("disconnect", err);

    // Update state
    this._wsClient = null;
    this._wsPreviousState = null;
    this._state = "disconnected";
  }
};

/**
 * Processes a ws error event.
 * The WebSocket client also fires a close event when an error occurs, so
 * this is to prevent unhandled error events and for debugging.
 * @memberof Browser
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
 * Connect the WebSocket.
 *
 * Called from
 *
 *  - Library call to transport.connect()
 *  - WebSocket close event handler (if library has requested reconnect)
 * @memberof Client
 * @instance
 * @private
 * @param {Error} err
 * @returns {void}
 */
proto._connect = function _connect() {
  dbg("Connecting the client");

  // Try to create the WebSocket client and emit disconnect asynchronously if constructor throws
  try {
    this._wsClient = new this._wsConstructor(
      this._address,
      config.wsSubprotocol
    );
  } catch (e) {
    dbg("Failed to initialize WebSocket client");
    dbg(e);

    // Update state
    this._state = "disconnected";
    this._wsClient = null; // May exist if due to close event
    this._wsPreviousState = null;

    // Emit disconnect
    const err = new Error(
      "FAILURE: Could not initialize the WebSocket client."
    );
    err.wsError = e;
    this._emitAsync("disconnect", err);
    return; // Stop
  }

  // Update state
  this._wsPreviousState = "connecting";

  // Listen for events
  this._wsClient.onopen = this._processWsOpen.bind(this);
  this._wsClient.onmessage = this._processWsMessage.bind(this);
  this._wsClient.onclose = this._processWsClose.bind(this);
  this._wsClient.onerror = this._processWsError.bind(this);
};

/**
 * Disconnects the transport client:
 *
 *  - Call to transport.disconnect()
 *  - WebSocket throws and error on ws.send()
 *
 * Resets the state, emits, and terminates the ws connection as appropriate.
 *
 * Cannot remove ws listeners. Need to listen for the close event to know when
 * you could try to attempt a new connection.
 * @memberof Browser
 * @instance
 * @private
 * @param {Error} err
 * @returns {void}
 */
proto._disconnect = function _disconnect(err) {
  dbg("Disconnecting the client");

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
    if (err) {
      dbg("Terminating client connection");
      this._wsClient.terminate();
    } else {
      dbg("Closing client connection");
      this._wsClient.close(1000);
    }
    this._wsPreviousState = "disconnecting";
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
 * @memberof Browser
 * @instance
 * @private
 * @param {*} ...args
 * @returns {void}
 */
proto._emitAsync = function _emitAsync(...args) {
  dbg(`Scheduling asynchronous emission: ${args[0]}`);

  setTimeout(() => {
    dbg(`Asynchronous emission: ${args[0]}`);
    this.emit(...args);
  }, 0);
};
