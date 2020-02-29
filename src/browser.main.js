/*

THIS IS THE OLD NODE-BROWSER JOINT CLIENT
REBUILD THIS BROWSER VERSION FROM THE NODE ONE

*/

import emitter from "component-emitter";
import check from "check-types";
import debug from "debug";

const dbg = debug("feedme-transport-ws:client");

/**
 * Client transport object.
 * @typedef {Object} Client
 * @extends emitter
 */

const proto = {};
emitter(proto);

/**
 * Client factory function.
 * @param {Function} WebSocket WebSocket implementation injection.
 * @param {string} address Endpoint address.
 * @param {?string|Array} protocols Protocols to pass to WebSocket.
 * @param {?Object} options Additional options for Node ws module.
 * @throws {Error} "INVALID_ARGUMENT: ..."
 * @returns {Client}
 */
export default function clientFactory(...args) {
  dbg("Initializing Client object");

  // Check ws
  if (!check.function(args[0])) {
    throw new Error("INVALID_ARGUMENT: Invalid ws argument.");
  }
  const WebSocket = args[0];

  // Check address
  if (!check.string(args[1])) {
    throw new Error("INVALID_ARGUMENT: Invalid address argument.");
  }
  // TODO: verify that this is a valid address format - don't wait until .connect()
  // See how ws does it
  const address = args[1];

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
    protocols = [];
  }

  // Check options (if specified)
  let options;
  if (args.length > 3) {
    if (!check.object(args[3])) {
      throw new Error("INVALID_ARGUMENT: Invalid options object.");
    }
    options = args[3]; // eslint-disable-line prefer-destructuring
  } else {
    options = {};
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
  client._WebSocket = WebSocket;

  /**
   * WebSocket client instance. Null if the transport state is disconnected.
   *
   * A new WebSocket client is created for each connection attempt, because
   * web sockets have a "closing" state during which you cannot communicate on
   * the socket nor can you initiate a new connection. The Feedme client library
   * requires that the transport state go directly from "connected" to
   * "disconnected".
   * @memberof Client
   * @instance
   * @private
   * @type {?Object}
   */
  client._ws = null;

  /**
   * Endpoint address
   * @memberof Client
   * @instance
   * @private
   * @type {string}
   */
  client._address = address;

  /**
   * Protocols for WebSocket
   * @memberof Client
   * @instance
   * @private
   * @type {string|Array}
   */
  client._protocols = protocols;

  /**
   * Additional options for Node ws module.
   * @memberof Client
   * @instance
   * @private
   * @type {Object}
   */
  client._options = options;

  /**
   * Client state
   * @memberof Client
   * @instance
   * @private
   * @type {string}
   */
  client._state = "disconnected";

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
 * Returns the client state: "disconnected", "connecting", or "connected".
 * @memberof Client
 * @instance
 * @returns {string}
 */
proto.state = function state() {
  dbg("State requested");

  return this._state;
};

/**
 * Begins connecting to the server.
 * @memberof Client
 * @instance
 * @throws {Error} "INVALID_STATE: ..."
 * @returns {void}
 */
proto.connect = function connect() {
  dbg("Connect requested");

  // Check state
  if (this._state !== "disconnected") {
    throw new Error("INVALID_STATE: Already connecting or connected.");
  }

  // Create the WebSocket client and listen for events
  this._ws = new this._WebSocket(this._address, this._protocols, this._options);
  this._ws.onopen = this._processWsOpen.bind(this);
  this._ws.onmessage = this._processWsMessage.bind(this);
  this._ws.onclose = this._processWsClose.bind(this);
  this._ws.onerror = this._processWsError.bind(this);

  // Update state and emit
  this._state = "connecting";
  this.emit("connecting");
};

/**
 * Send a message to the server.
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

  // Check state
  if (this._state !== "connected") {
    throw new Error("INVALID_STATE: Not connected.");
  }

  // Send the message
  this._ws.send(msg);
};

/**
 * Disconnects from the server.
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
    if (!check.object(err)) {
      throw new Error("INVALID_ARGUMENT: Invalid error");
    }
  }

  // Check state
  if (this._state === "disconnected") {
    throw new Error("INVALID_STATE: Already disconnected.");
  }

  // Remove all ws listeners
  this._ws.onopen = undefined;
  this._ws.onmessage = undefined;
  this._ws.onclose = undefined;
  this._ws.onerror = undefined;

  // Close the ws connection
  // Listeners have been removed, so this will not cause a transport disconnect event
  this._ws.close(1000); // Normal closure
  // The above is the only method available on the browser
  // In Node, the ws docs also have a .terminate() method to "forcibly" close the
  // connection -- do I need to use that if the ws is opening?

  // Update state
  this._ws = null;
  this._state = "disconnected";

  // Emit
  if (err) {
    this.emit("disconnect", err);
  } else {
    this.emit("disconnect");
  }
};

// WebSocket event handlers

/**
 * Processes a WebSocket open event.
 * @memberof Client
 * @instance
 * @returns {void}
 */
proto._processWsOpen = function _processWsOpen() {
  dbg("Observed ws open event");

  this._state = "connected";
  this.emit("connect");
};

/**
 * Processes a WebSocket message event.
 * @memberof Client
 * @instance
 * @param {*} msg
 * @returns {void}
 */
proto._processWsMessage = function _processWsMessage(event) {
  dbg("Observed ws message event");

  // Check data type - could be String, Buffer, ArrayBuffer, Buffer[]
  if (!check.string(event.data)) {
    dbg("Unexpected ws message type");
    dbg(event.data);
    this.disconnect(
      new Error(
        "DISCONNECTED: Received invalid message type on WebSocket connection."
      )
    );
    return; // Stop
  }

  this.emit("message", event.data);
};

/**
 * Processes a WebSocket close event.
 * Only fired on unexpected closure, because transport.disconnect() removes
 * event listeners from the WebSocket.
 * @memberof Client
 * @instance
 * @param {?number} code
 * @param {?string} reason
 * @returns {void}
 */
proto._processWsClose = function _processWsClose(event) {
  dbg("Observed ws close event");

  // Remove all ws listeners
  this._ws.onopen = undefined;
  this._ws.onmessage = undefined;
  this._ws.onclose = undefined;
  this._ws.onerror = undefined;

  // Update state
  this._state = "disconnected";
  this._ws = null;

  // Emit event
  const err = new Error(
    `DISCONNECTED: The WebSocket connection was lost (${event.code}). Reason: ${event.reason}`
  );
  this.emit("disconnect", err);
};

/**
 * Processes a WebSocket error event.
 * The WebSocket client also fires a close event when an error occurs, so
 * this is for debugging purposes only.
 * @memberof Client
 * @instance
 * @param {?number} code
 * @param {?string} reason
 * @returns {void}
 */
proto._processWsError = function _processWsError(event) {
  dbg("Observed ws error event");
  dbg(event.error);
};
