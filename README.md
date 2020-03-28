[![Build Status](https://travis-ci.com/aarong/feedme-transport-ws.svg?branch=master)](https://travis-ci.com/aarong/feedme-transport-ws)
[![Coverage Status](https://coveralls.io/repos/github/aarong/feedme-transport-ws/badge.svg?branch=master)](https://coveralls.io/github/aarong/feedme-transport-ws?branch=master)

[![Feedme](https://raw.githubusercontent.com/aarong/feedme-transport-ws/master/logo.svg?sanitize=true)](https://feedme.global)

# Feedme Javascript WebSocket Transport

WebSocket client and server transports for the
[Feedme Javascript Client](https://github.com/aarong/feedme-client) and
[Feedme Node.js Server Core](https://github.com/aarong/feedme-server-core)
libraries.

The server transport runs on Node.js. The client transport runs on Node.js and
in the browser.

Created and maintained as a core part of the [Feedme](https://feedme.global)
project.

<!-- TOC depthFrom:2 -->

- [Server](#server)
  - [Initialization](#initialization)
  - [Transport-Specific Information](#transport-specific-information)
- [Client](#client)
  - [In Node.js](#in-nodejs)
    - [Connection Issues with ws (what to call this section??)](#connection-issues-with-ws-what-to-call-this-section)
  - [In the Browser](#in-the-browser)
    - [NPM](#npm)
    - [CDN](#cdn)
- [Compatibility](#compatibility)

<!-- /TOC -->

## Server

The server transport lets you serve a Feedme API over WebSockets in Node.js.

Depends on the [ws](https://github.com/websockets/ws) module and supports
everything that it does, including HTTPS, stand-alone WebSocket servers,
external HTTP servers. Uses ws version 6.2.x to retain Node 6 support.

To install the Feedme Server Core library and the WebSocket transport:

`npm install feedme-server-core feedme-transport-ws`

### Initialization

To initialize a Feedme server:

```javascript
const feedmeServerCore = require("feedme-server-core");
const feedmeTransportWs = require("feedme-transport-ws/server");

const server = feedmeServerCore({
  transport: feedmeTransportWs(options)
});
```

The `options` argument is passed to the ws module and can be used to configure
the underlying WebSocket server. See the
([ws documentation](https://github.com/websockets/ws/blob/master/doc/ws.md#new-websocketserveroptions-callback))
for options.

The transport also incorporates a heartbeat system, which can be confired using:

- `options.heartbeatIntervalMs` - Optional non-negative integer. Defaults
  to 5000.

  Specifies how often to send a WebSocket ping to each client to ensure
  responsiveness.

  If set to 0, then the server will not ping clients.

- `options.heartbeatTimeoutMs` - Optional positive integer. Defaults to 4999.

  Specifies how long to wait after pinging a client until the connection is
  considered to have been lost and the WebSocket is terminated.

  Must be strictly less than `options.heartbeatIntervalMs` if specified.

Example: To serve a Feedme API on a stand-alone WebSocket server:

```javascript
const feedmeServerCore = require("feedme-server-core");
const feedmeTransportWs = require("feedme-transport-ws/server");

const server = feedmeServerCore({
  transport: feedmeTransportWs({
    port: 8080
  })
});
```

Example: To serve a Feedme API on an existing HTTP server:

```javascript
const http = require("http");
const feedmeServerCore = require("feedme-server-core");
const feedmeTransportWs = require("feedme-transport-ws/server");

const httpServer = http.createServer(function (req, res) => {
  res.writeHead(200);
  res.end("Welcome");
});
httpServer.listen(8080);

const feedmeServer = feedmeServerCore({
  transport: feedmeTransportWs({
    server: httpServer,
    path: "/feedme"
  })
});
feedmeServer.start();
```

A few considerations when serving an API on an existing HTTP server:

- The HTTP server need not be listening in order to construct the Feedme
  transport and server. If there is a call to `feedmeServer.start()` and the
  external HTTP server is not listening, then the Feedme transport/server will
  emit `starting` and will then wait for the HTTP server to be started by the
  application (the library/transport will not attempt to start it), at which
  point the Feedme transport/server will emit `start`. If the HTTP server is
  already listening when the application calls `feedmeServer.start()`, then the
  Feedme transport/server emit `starting` and `start` immediately.

- Once the server has started, calling `feedmeServer.stop()` will not close the
  external HTTP server, but will close the WebSocket layer on top of it. If the
  external HTTP server is closed by the application then the Feedme
  transport/server will become `stopped` and will emit `stopping` and `stop`, so
  the application should not also call `feedmeServer.stop()`.

Example: To serve multiple Feedme APIs on a single HTTP server:

```javascript
// Create the basic HTTP server
const httpServer = http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Welcome");
});
httpServer.listen(port);

// Create the first Feedme server
const feedmeTransport1 = feedmeTransportWs({
  noServer: true
});
const feedmeServer1 = feedmeServerCore({
  transport: feedmeTransport1
});
feedmeServer1.on("connect", clientId => {
  // Got a Feedme API client on /feedme1
});
feedmeServer1.start();

// Create the second Feedme server
const feedmeTransport2 = feedmeTransportWs({
  noServer: true
});
const feedmeServer2 = feedmeServerCore({
  transport: feedmeTransport2
});
feedmeServer2.on("connect", clientId => {
  // Got a Feedme API client on /feedme2
});
feedmeServer2.start();

// Route WebSocket upgrade requests to the appropriate Feedme server
httpServer.on("upgrade", (request, socket, head) => {
  const { pathname } = url.parse(request.url);

  if (pathname === "/feedme1") {
    feedmeTransport1.handleUpgrade(request, socket, head);
  } else if (pathname === "/feedme2") {
    feedmeTransport2.handleUpgrade(request, socket, head);
  } else {
    socket.destroy();
  }
});
```

A few considerations when serving a Feedme API in `noServer` mode:

- The application still needs to call `feedmeServer.start()` and the transport
  will throw an error if the application calls `feedmeTransport.handleUpgrade()`
  when the server is not started.

- The transport will not automatically know if the HTTP server stops, though it
  will observe that existing clients disconnect. If the HTTP server stops, the
  application should call `feedmeServer.stop()`.

Example: To run a Feedme API alongside an existing WebSocket service on the same
HTTP server:

```javascript
// Create the basic HTTP server
const httpServer = http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Welcome");
});
httpServer.listen(port);

// Create a raw WebSocket server
const wsServer = new WebSocket.Server({ noServer: true });
wsServer.on("connection", ws => {
  // Got a raw WebSocket connection on /ws
});

// Create a Feedme server
const feedmeTransport = feedmeTransportWs({
  noServer: true
});
const feedmeServer = feedmeServerCore({
  transport: feedmeTransport
});
feedmeServer.on("connect", clientId => {
  // Got a Feedme API client on /feedme
});
feedmeServer.start();

// Route upgrade requests to WebSocket or Feedme server as appropriate
httpServer.on("upgrade", (request, socket, head) => {
  const { pathname } = url.parse(request.url);

  if (pathname === "/ws") {
    wsServer.handleUpgrade(request, socket, head, ws => {
      wsServer.emit("connection", ws, request);
    });
  } else if (pathname === "/feedme") {
    feedmeTransport.handleUpgrade(request, socket, head);
  } else {
    socket.destroy();
  }
});
```

### Transport-Specific Information

The following transport-specific information is made available to the
application via the library:

- If `ws` throws an error on initialization, then the `err` argument passed with
  the library `stopping` and `stopped` events have a `err.wsError` property
  referencing the error thrown by `ws`.

- If `ws` indicates that an active connection was terminated unexpectedly, then
  the `err` argument passed with the transport `disconnect` event has
  `err.wsCode` and `err.wsReason` properties containing the code and reason
  specified by `ws`.

- When the application server calls `server.transportClient(cid)` (??) it gets
  an object with a remoteHost property?

## Client

Client transport lets you connect to a Feedme API server over Webockets from
Node.js and from the browser.

### In Node.js

The Node.js client depends on the [ws](https://github.com/websockets/ws) module
and supports everything it does. Uses ws version 6.2.x to retain Node 6 support.

To install the Feedme client library and the WebSocket tranport:

`npm install feedme-client feedme-transport-ws`

To initialize a Feedme client:

```javascript
const feedmeClient = require("feedme-client");
const feedmeTransportWs = require("feedme-transport-ws/client");

const client = feedmeClient({
  transport: feedmeTransportWs(address, protocols, options);
});
```

Arguments:

- `address` - Required string. The transport server WebSocket URL.

- `protocols` Optional string or array. Protocols passed to the ws module.

- `options` Optional object. The object is passed to the ws module and can be
  used to configure the underlying WebSocket client. See the
  ([ws documentation](https://github.com/websockets/ws/blob/master/doc/ws.md#new-websocketaddress-protocols-options))
  for options.

  The Node transport client also incorporates a heartbeat system, which can be
  confired using:

  - `options.heartbeatIntervalMs` - Optional non-negative integer. Defaults
    to 5000.

    Specifies how often to send a WebSocket ping to the server to ensure
    responsiveness.

    If set to 0, then the client will not ping the server.

  - `options.heartbeatTimeoutMs` - Optional positive integer. Defaults to 4999.

    Specifies how long to wait after pinging the server until the connection is
    considered to have been lost.

    Must be strictly less than `options.heartbeatIntervalMs` if specified.

Example: Connect to a the WebSocket API server on _localhost:8080_:

```javascript
const feedmeClient = require("feedme-client");
const feedmeTransportWs = require("feedme-transport-ws/client");

const client = feedmeClient({
  transport: feedmeTransportWs("ws://localhost:8080");
});
```

#### Connection Issues with ws (what to call this section??)

If `ws` throws an error on initialization, then the `err` argument passed with
the transport `disconnect` event has a `err.wsError` property referencing the
error thrown by `ws`.

If `ws` indicates that an active connection was terminated unexpectedly, then
the `err` argument passed with the transport `disconnect` event has `err.wsCode`
and `err.wsReason` properties containing the code and reason specified by `ws`.

### In the Browser

The browser client uses the native WebSocket implementation available in the
browser.

The browser client can be installed using NPM and bundled into a Node web
application, or retrieved on a web page using a CDN.

The browser client has the same API as the Node client except that it does not
accept an `options` object.

The browser client does not have a heartbeat feature because browser WebSocket
implementations don't expose a ping API.

#### NPM

To install the Feedme Client library and WebSocket tranport:

`npm install feedme-client feedme-transport-ws`

To initialize a Feedme client:

```javascript
const feedmeClient = require("feedme-client");
const feedmeTransportWs = require("feedme-transport-ws/browser");

const client = feedmeClient({
  transport: feedmeTransportWs(address, protocols);
});
```

#### CDN

To load the Feedme Client library and WebSocket transport:

```html
<script
  type="text/javascript"
  src="https://cdn.jsdelivr.net/npm/feedme-client"
></script>
<script
  type="text/javascript"
  src="https://cdn.jsdelivr.net/npm/feedme-transport-ws"
></script>
```

The module is bundled in UMD format and is named `feedmeTransportWs` in the
global scope.

To initialize a Feedme client:

```javascript
const feedmeClient = require("feedme-client");
const feedmeTransportWs = require("feedme-transport-ws/browser");

const client = feedmeClient({
  transport: feedmeTransportWs(address, protocols);
});
```

## Compatibility

These modules should compatible be with other WebSocket Feedme transport
implementations, provided that (1) they transmit Feedme messages using
single-string WebSocket messages, and (2) do not transmit anything else on the
WebSocket.
