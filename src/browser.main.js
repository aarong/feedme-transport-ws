import emitter from "component-emitter";
import check from "check-types";
import debug from "debug";
import config from "./config";

const dbg = debug("feedme-transport-ws:client");

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
 * @throws {Error} "INVALID_ARGUMENT: ..."
 * @returns {Client}
 */
export default function browserFactory(...args) {
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

  // Check address format (don't wait for WebSocket initialization to fail)
  try {
    new URL(address); // eslint-disable-line no-new
  } catch (e) {
    throw new Error("INVALID_ARGUMENT: Invalid address argument.");
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
   * WebSocket client instance. Null if transport is disconnected.
   *
   * If a WebSocket client exists then all event handlers are attached.
   * @memberof Browser
   * @instance
   * @private
   * @type {?Object}
   */
  browser._wsClient = null;

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
   * Endpoint address passed to WebSocket.
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
 * @param {?Error} err "FAILURE: ..." if not due to call to client.disconnect()
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

  // Try to create the WebSocket client
  try {
    this._wsClient = new this._wsConstructor(
      this._address,
      config.wsSubprotocol,
    );
  } catch (e) {
    dbg("Failed to initialize WebSocket client");

    // Update state and emit disconnect asynchronously
    this._state = "disconnected";
    const err = new Error(
      "FAILURE: Could not initialize the WebSocket client.",
    );
    err.wsError = e;
    this._emitAsync("disconnect", err);
    return; // Stop
  }

  // Listen for events
  this._wsClient.onopen = this._processWsOpen.bind(this);
  this._wsClient.onmessage = this._processWsMessage.bind(this);
  this._wsClient.onclose = this._processWsClose.bind(this);
  this._wsClient.onerror = this._processWsError.bind(this);
};

/**
 * The library wants the transport to disconnect. The transport could be
 * connecting or connected.
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
    return; // Stop
  }
  dbg("Message written successfully");
};

// WebSocket event handlers

/**
 * Processes a WebSocket open event.
 * @memberof Browser
 * @instance
 * @private
 * @returns {void}
 */
proto._processWsOpen = function _processWsOpen() {
  dbg("Observed WebSocket open event");

  // Update state and emit
  this._state = "connected";
  this._emitAsync("connect");
};

/**
 * Processes a WebSocket message event.
 * @memberof Browser
 * @instance
 * @private
 * @param {MessageEvent} evt
 * @returns {void}
 */
proto._processWsMessage = function _processWsMessage(evt) {
  dbg("Observed WebSocket message event");

  // Check data type - could be String, Buffer, ArrayBuffer, Buffer[]
  if (!check.string(evt.data)) {
    dbg("Unexpected WebSocket message type");
    dbg(evt.data);
    this._disconnect(
      new Error(
        "FAILURE: Received non-string message on WebSocket connection.",
      ),
    );
    return; // Stop
  }

  this._emitAsync("message", evt.data);
};

/**
 * Processes a WebSocket close event.
 *
 * All WebSocket listeners are removed by _disconnect(), so this function is only
 * called if there is an unexpected connection closure.
 * @memberof Browser
 * @instance
 * @private
 * @param {?number} code
 * @param {?string} reason
 * @returns {void}
 */
proto._processWsClose = function _processWsClose(code, reason) {
  dbg("Observed WebSocket close event");

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
 * Processes a WebSocket error event.
 * The WebSocket client also fires a close event when an error occurs.
 * This handler prevents unhandled error events and helps debugging.
 * @memberof Browser
 * @instance
 * @private
 * @param {?number} code
 * @param {?string} reason
 * @returns {void}
 */
proto._processWsError = function _processWsError(err) {
  dbg("Observed WebSocket error event");
  dbg(err);
};

// Internal Functions

/**
 * Disconnect the transport client.
 *
 *  - Call to transport.disconnect()
 *  - Unexpected connection closure
 *  - WebSocket throws on call to send()
 *
 * Resets the state, emits, and closes the WebSocket connection as appropriate.
 * @memberof Browser
 * @instance
 * @private
 * @param {Error} err
 * @returns {void}
 */
proto._disconnect = function _disconnect(err) {
  dbg("Disconnecting the client");

  // Remove all WebSocket listeners (if present)
  if (this._wsClient) {
    this._wsClient.onopen = null;
    this._wsClient.onmessage = null;
    this._wsClient.onclose = null;
    this._wsClient.onerror = null;
  }

  // Clear heartbeat (if any)
  clearInterval(this._heartbeatInterval);
  this._heartbeatInterval = null;
  clearTimeout(this._heartbeatTimeout);
  this._heartbeatTimeout = null;

  // Remove the Websocket client reference
  const wsClient = this._wsClient;
  this._wsClient = null;

  // Close the WebSocket connection (if any)
  if (wsClient) {
    const close = () => {
      dbg("Closing client connection");
      wsClient.close(1000);
    };
    if (wsClient.readyState === wsClient.OPEN) {
      // The WebSocket instance is open - close it
      dbg("The WebSocket connection is open");
      close();
    } else if (wsClient.readyState === wsClient.CONNECTING) {
      // The WebSocket instance is opening - close it if it eventually opens
      dbg("The WebSocket connection is opening");
      wsClient.onopen = () => {
        close();
        wsClient.onopen = null;
      };
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
 * (i.e. methods) are emitted asynchronously. But it is not clear whether
 * WebSocket may in some cases emit synchronously, so in order to ensure
 * a correct sequence of transport events, all are emitted asynchronously.
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
