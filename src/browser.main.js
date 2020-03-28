import emitter from "component-emitter";
import check from "check-types";
import debug from "debug";

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
 * @param {?string|Array} protocols Protocols for WebSocket
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
    throw new Error("INVALID_ARGUMENT: Invalid address argument.");
  }

  // Check protocols (if specified)
  let protocols;
  if (args.length > 2) {
    if (check.string(args[2])) {
      protocols = args[2]; // eslint-disable-line prefer-destructuring
    } else if (check.array(args[2])) {
      args[2].forEach(protocol => {
        if (!check.string(protocol)) {
          throw new Error("INVALID_ARGUMENT: Invalid protocols argument.");
        }
      });
      protocols = args[2].join(",");
    } else {
      throw new Error("INVALID_ARGUMENT: Invalid protocols argument.");
    }
  } else {
    protocols = "";
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

  /**
   * Protocols passed to ws. Must be a string for browsers, unlike ws, which
   * also accepts arrays.
   * @memberof Browser
   * @instance
   * @private
   * @type {string}
   */
  browser._protocols = protocols;

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
 * @param {?Error} err "DISCONNECTED: ..." if not due to call to client.disconnect()
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

  // Update state and emit
  this._state = "connecting";
  this.emit("connecting");

  // If the ws client is disconnected then start connecting, otherwise wait for ws event
  if (!this._wsClient) {
    dbg("Initializing ws client");

    // Try to create the WebSocket client and emit disconnect if constructor throws
    try {
      this._wsClient = new this._wsConstructor(
        this._address,
        this._protocols ? this._protocols : undefined
      );
    } catch (e) {
      dbg("Failed to initialize ws client");
      dbg(e);
      const err = new Error(
        "DISCONNECTED: Could not initialize the WebSocket client."
      );
      err.wsError = e;
      this._state = "disconnected";
      this.emit("disconnect", err);
      return; // Stop
    }

    // Update state
    this._wsPreviousState = "connecting";

    // Listen for events
    this._wsClient.onopen = this._processWsOpen.bind(this);
    this._wsClient.onmessage = this._processWsMessage.bind(this);
    this._wsClient.close = this._processWsClose.bind(this);
    this._wsClient.onerror = this._processWsError.bind(this);
  }
};

/**
 * The library wants the transport to disconnect.
 * The WebSocket client state could be anything except disconnected.
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

  // Close the ws connection if it's open, otherwise wait for ws event
  if (this._wsClient.readyState === this._wsClient.OPEN) {
    this._wsClient.close(1000, "Connection closed by the client.");
    this._wsPreviousState = "disconnecting";
  }

  // Update state and emit
  this._state = "disconnected";
  if (err) {
    this.emit("disconnect", err);
  } else {
    this.emit("disconnect");
  }
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
    this._connectionFailure(transportErr);
  }
  dbg("Message written successfully");
};

// WebSocket event handlers

/**
 * Processes a WebSocket open event.
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
    this.emit("connect");
  }
};

/**
 * Processes a WebSocket message event.
 * @memberof Browser
 * @instance
 * @private
 * @param {*} msg
 * @returns {void}
 */
proto._processWsMessage = function _processWsMessage(evt) {
  dbg("Observed ws message event");

  // Check data type - could be String, Buffer, ArrayBuffer, Buffer[]
  if (!check.string(evt.data)) {
    dbg("Unexpected WebSocket message type");
    dbg(evt.data);
    this.disconnect(
      new Error(
        "DISCONNECTED: Received invalid message type on WebSocket connection."
      )
    );
    return; // Stop
  }

  this.emit("message", evt.data);
};

/**
 * Processes a WebSocket close event.
 *
 * The WebSocket client will emit a close event if the initial connection could not
 * be established, if an open connection is closed normally, and if an open
 * connection fails due to an error.
 * @memberof Browser
 * @instance
 * @private
 * @param {?number} code
 * @param {?string} reason
 * @returns {void}
 */
proto._processWsClose = function _processWsClose(evt) {
  dbg("Observed ws close event");

  // Remove all ws listeners
  this._wsClient.onopen = null;
  this._wsClient.onmessage = null;
  this._wsClient.onclose = null;
  this._wsClient.onerror = null;

  if (this._state === "disconnected") {
    // There was a call to transport.disconnect() or a call to ws.send() threw
    // The disconnect event has already been emitted and the library still wants
    // the transport disconnected
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
        this._protocols ? this._protocols : undefined
      );
    } catch (e) {
      dbg("Failed to initialize ws client");
      dbg(e);
      this._wsClient = null; // Otherwise it will be the previous client
      this._wsPreviousState = null;
      this._state = "disconnected";
      const err = new Error(
        "DISCONNECTED: Could not initialize the WebSocket client."
      );
      err.wsError = e;
      this.emit("disconnect", err);
      return; // Stop
    }

    // Update state
    this._wsPreviousState = "connecting";

    // Listen for events
    this._wsClient.onopen = this._processWsOpen.bind(this);
    this._wsClient.onmessage = this._processWsMessage.bind(this);
    this._wsClient.close = this._processWsClose.bind(this);
    this._wsClient.onerror = this._processWsError.bind(this);
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
    err.wsCode = evt.code;
    err.wsReason = evt.reason;
    this.emit("disconnect", err);
  }
};

/**
 * Processes a WebSocket error event.
 * The WebSocket client also fires a close event when an error occurs, so
 * this is for debugging purposes only.
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
 * Handles an abnormal connection failure:
 *
 *  - Ws throws error to ws.send()
 *
 * Resets the state, emits, and terminates the ws connection as appropriate.
 * @memberof Browser
 * @instance
 * @private
 * @param {Error} err
 * @returns {void}
 */
proto._connectionFailure = function _connectionFailure(err) {
  dbg("Connection failed");

  // Terminate the ws connection if it's still open
  // Triggers a ws close event asynchronously, which resets _wsClient and _wsPreviousState
  if (this._wsClient && this._wsClient.readyState === this._wsClient.OPEN) {
    this._wsClient.terminate();
    this._wsPreviousState = "disconnecting";
  }

  // Update state and emit synchronously
  if (this._state !== "disconnected") {
    this._state = "disconnected";
    this.emit("disconnect", err);
  }
};
