const WebSocket = require("ws");
const emitter = require("component-emitter");
const uuid = require("uuid");

const proto = {};
emitter(proto);

module.exports = function serverFactory() {
  const server = Object.create(proto);

  server._state = "stopped";
  server._wss = null;
  server._clients = {};

  return server;
};

proto.state = function state() {
  return this._state;
};

proto.start = function start() {
  this._state = "starting";
  this.emit("starting");

  this._wss = new WebSocket.Server({
    port: 8080
  });

  this._wss.on("listening", () => {
    this._state = "started";
    this.emit("start");
  });

  this._wss.on("close", () => {
    this._wss = null;
    this._clients = {};

    this._state = "stopped";
    this.emit("stopping", new Error("FAILURE: Web socket server stopped."));
    this.emit("stop", new Error("FAILURE: Web socket server stopped."));
  });

  this._wss.on("connection", ws => {
    const cid = uuid();

    this._clients[cid] = ws;

    ws.on("message", msg => {
      this.emit("message", cid, msg);
    });

    // eslint-disable-next-line
    ws.on("close", (code, reason) => {
      delete this._clients[cid];
      this.emit("disconnect", cid, new Error("FAILURE: WebSocket closed."));
    });

    this.emit("connect", cid);
  });
};

proto.send = function send(cid, msg) {
  this._clients[cid].send(msg);
};

proto.disconnect = function disconnect(cid) {
  this._clients[cid].terminate(); // Triggers event?
};

proto.stop = function stop() {
  this._state = "stopping";
  this.emit("stopping");
  this._wss.close(() => {
    this._state = "stopped";
    this.emit("stopped");
  });
};
