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
 * @param {Function} ws WebSocket implementation injection.
 * @param {string} address Endpoint address.
 * @param {?string|Array} protocols Protocols to pass to WebSocket.
 * @param {?Object} options Options to pass to Node's ws object.
 * @throws {Error} "INVALID_ARGUMENT: ..."
 * @returns {Client}
 */
module.exports = function clientFactory(...args) {
  dbg("Initializing Client object");

  // Check ws
  if (!check.function(args[0])) {
    throw new Error("INVALID_ARGUMENT: Invalid ws argument.");
  }
  const ws = args[0];

  // Check address
  if (!check.string(args[1])) {
    throw new Error("INVALID_ARGUMENT: Invalid address argument.");
  }
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
   * WebSocket implementation (Node/browser)
   * @memberof Client
   * @instance
   * @private
   * @type {Object}
   */
  client._ws = ws;

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
   * Options for Node WebSocket
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

  /**
   * WebSocket instance. Null if client state is not connecting or connected.
   * @memberof Client
   * @instance
   * @private
   * @type {?Object}
   */
  client._wsClient = null;

  return client;
};

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
 * Initiates a connection to the server.
 *
 * A new WebSocket client is created for each connection cycle. This is because
 * web sockets have a "closing" state when the closing handshake is in
 * progress, at which point you cannot communicate on the socket, nor can
 * you initiate a new connection. The Feedme client library requires that
 * the transport state go directly from "connected" to "disconnected".
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

  // Create the ws client and listen for events
  // options.url might be an invalid format - test (will ws throw?)
  // Make sure passing extraneous options arg doesn't fail in browsers
  this._wsClient = new this._ws(this._address); // , this._protocols, this._options);
  this._wsClient.addEventListener("open", this._processWsOpen.bind(this));
  this._wsClient.addEventListener("close", this._processWsClose.bind(this));
  this._wsClient.addEventListener("error", this._processWsError.bind(this));
  this._wsClient.addEventListener("message", this._processWsMessage.bind(this));

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

  // Check state
  this._wsClient.send(msg);
};

/**
 * Disconnects from the server.
 *
 * Removes all listeners and destroys the ws object, because the transport
 * state must immediately become "disconnected" but the ws will only
 * become "closing".
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
  // For browsers you need to use removeEventListener and keep listener references
  // this._wsClient.removeAllListeners("open");
  // this._wsClient.removeAllListeners("close");
  // this._wsClient.removeAllListeners("error");
  // this._wsClient.removeAllListeners("message");

  // Close the ws connection
  if (this._state === "connecting") {
    // Can't do a ws closing handshake
    this._wsClient.terminate();
  } else {
    this._wsClient.close(1000); // Normal closure
  }

  // Update state
  this._wsClient = null;
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
 * Processes a ws open event.
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
 * Processes a ws close event.
 * Only handles unexpected closures (i.e. not from a library call to client.disconnect())
 * because listeners are removed on call to client.disconnect();
 * @memberof Client
 * @instance
 * @param {?number} code
 * @param {?string} reason
 * @returns {void}
 */
proto._processWsClose = function _processWsClose(event) {
  dbg("Observed ws close event");

  // Remove all ws listeners
  // FIX
  // this._wsClient.removeAllListeners("open");
  // this._wsClient.removeAllListeners("close");
  // this._wsClient.removeAllListeners("error");
  // this._wsClient.removeAllListeners("message");

  // Update state
  this._state = "disconnected";
  this._wsClient = null;

  const err = new Error(
    `DISCONNECTED: The WebSocket connection was lost (${event.code}). Reason: ${event.reason}`
  );
  this.emit("disconnect", err);
};

/**
 * Processes a ws error event.
 * The ws module terminates the connection after an error event, firing a
 * close event, so just log the error.
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

/**
 * Processes a ws message event.
 * @memberof Client
 * @instance
 * @param {*} msg
 * @returns {void}
 */
proto._processWsMessage = function _processWsMessage(event) {
  dbg("Observed ws message event");

  // Check data type
  // Could be String, Buffer, ArrayBuffer, Buffer[]
  // Close the connection and log on unexpected message type
  if (!check.string(event.data)) {
    dbg("Unexpected ws message type");
    dbg(event.data);

    this.disconnect(new Error("DISCONNECTED: Received invalid message type."));
    return;
  }

  this.emit("message", event.data);
};
