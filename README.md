[![Build Status](https://travis-ci.com/aarong/feedme-transport-ws.svg?branch=master)](https://travis-ci.com/aarong/feedme-transport-ws)
[![Coverage Status](https://coveralls.io/repos/github/aarong/feedme-transport-ws/badge.svg?branch=master)](https://coveralls.io/github/aarong/feedme-transport-ws?branch=master)

[![Feedme](https://raw.githubusercontent.com/aarong/feedme-transport-ws/master/logo.svg?sanitize=true)](https://feedme.global)

# Feedme Javascript WebSocket Transport

WebSocket transports for the
[Feedme Javascript Client](https://github.com/aarong/feedme-client) and
[Feedme Node.js Server Core](https://github.com/aarong/feedme-server-core)
libraries.

The server transport runs on Node.js. The client transport runs on Node.js and
in the browser.

Created and maintained as a core part of the [Feedme](https://feedme.global)
project.

<!-- TOC depthFrom:2 -->

- [Server](#server)
  - [Installation](#installation)
  - [Initialization](#initialization)
  - [Usage: Feedme API on a Stand-Alone WebSocket Server](#usage-feedme-api-on-a-stand-alone-websocket-server)
  - [Usage: Feedme API on an Existing HTTP/S Server](#usage-feedme-api-on-an-existing-https-server)
  - [Usage: Multiple Feedme APIs on a Single HTTP/S Server](#usage-multiple-feedme-apis-on-a-single-https-server)
  - [WebSocket Errors](#websocket-errors)
- [Node.js Client](#nodejs-client)
  - [Installation](#installation-1)
  - [Initialization](#initialization-1)
  - [WebSocket Errors](#websocket-errors-1)
- [Browser Client](#browser-client)
  - [Installation](#installation-2)
  - [Initialization](#initialization-2)
  - [WebSocket Errors](#websocket-errors-2)
- [Compatibility](#compatibility)

<!-- /TOC -->

## Server

The server transport lets you serve a Feedme API over WebSockets in Node.js.

The server transport is built on top of the
[ws module](https://github.com/websockets/ws) and supports everything that it
does, including HTTPS and compression. The transport depends on ws version 6.2.x
in order to retain Node 6 support.

### Installation

To install the NPM package:

`npm install feedme-server-core feedme-transport-ws`

### Initialization

To initialize a Feedme server:

```javascript
const feedmeServerCore = require("feedme-server-core");
const feedmeTransportWs = require("feedme-transport-ws/server");

const server = feedmeServerCore({
  transport: feedmeTransportWs(options),
});
```

The `options` argument is passed internally to the ws module and can be used to
configure the underlying WebSocket server. See the
[ws documentation](https://github.com/websockets/ws/blob/master/doc/ws.md#new-websocketserveroptions-callback)
for options. The application must not specify the `handleProtocols` option,
which is used internally by the transport.

The transport also incorporates a heartbeat system, which can be confired using:

- `options.heartbeatIntervalMs` - Optional non-negative integer. Defaults
  to 5000.

  Specifies how often to send a WebSocket ping to each client to ensure
  continued responsiveness.

  If set to 0, then the server will not ping clients.

- `options.heartbeatTimeoutMs` - Optional positive integer. Defaults to 4500.

  Specifies how long to wait after pinging a client until the connection is
  considered to have been lost and the WebSocket is terminated.

  Must be strictly less than `options.heartbeatIntervalMs` if specified.

Errors thrown:

- `err.message === "INVALID_ARGUMENT"`

  There was a problem with one or more of the supplied arguments.

### Usage: Feedme API on a Stand-Alone WebSocket Server

To serve a Feedme API on a single-purpose WebSocket server accepting connections
on all paths:

```javascript
const feedmeServerCore = require("feedme-server-core");
const feedmeTransportWs = require("feedme-transport-ws/server");

const server = feedmeServerCore({
  transport: feedmeTransportWs({
    port: 8080,
  }),
});
server.start();
```

### Usage: Feedme API on an Existing HTTP/S Server

To serve a Feedme API on a specific path of an existing HTTP/S server:

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

When serving a Feedme API on an existing HTTP/S server:

- The external HTTP server is not required to be listening in order to
  initialize the Feedme transport and server. The transport does not attempt to
  start or stop the external HTTP server.

- If there is a call to `feedmeServer.start()` and the external HTTP server is
  not already listening, then `feedmeServer` will become `starting` and wait for
  the HTTP server to be started by the application, at which point
  `feedmeServer` will become `started`. If the HTTP server is already listening
  when the application calls `feedmeServer.start()`, then `feedmeServer` will
  become `started` immediately.

- If the external HTTP server stops listening for new connections, either due to
  a failure or an application call to `httpServer.close()`, then `feedmeServer`
  will automatically become `stopped` and any existing clients will be
  disconnected. If the external HTTP server is subsequently restarted then the
  application must call `feedmeServer.start()` to re-launch the Feedme server.

- If there is a call to `feedmeServer.stop()` while the external HTTP server is
  running then the WebSocket endpoint is removed and the external server is left
  running.

### Usage: Multiple Feedme APIs on a Single HTTP/S Server

To serve multiple Feedme APIs on a single HTTP/S server:

```javascript
const http = require("http");
const feedmeServerCore = require("feedme-server-core");
const feedmeTransportWs = require("feedme-transport-ws/server");

// Create the basic HTTP server
const httpServer = http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Welcome");
});
httpServer.listen(port);

// Create the first Feedme server
const feedmeTransport1 = feedmeTransportWs({
  noServer: true,
});
const feedmeServer1 = feedmeServerCore({
  transport: feedmeTransport1,
});
feedmeServer1.start();

// Create the second Feedme server
const feedmeTransport2 = feedmeTransportWs({
  noServer: true,
});
const feedmeServer2 = feedmeServerCore({
  transport: feedmeTransport2,
});
feedmeServer2.start();

// Route WebSocket upgrade requests to the appropriate Feedme transport
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

When serving a Feedme API in `noServer` mode:

- The transport has no way of knowing whether the external HTTP server is
  listening for connections. It is up to the application to start and stop the
  Feedme server as appropriate.

- The application must call `feedmeServerX.start()` before making calls to
  `feedmeTransportX.handleUpgrade()`. The Feedme server will immediately become
  `started`.

- A call to `httpServer.close()` will cause the external HTTP server to stop
  listening for new connections, but it will not terminate existing connections
  and `httpServer` will not emit close until all WebSocket clients have
  disconnected. If the application closes the external HTTP server, it should
  also call `feedmeServerX.stop()`, which will cause the transport to close all
  existing WebSocket connections.

### WebSocket Errors

The transport makes the following ws-level error information available via the
Feedme server library.

- If there is a problem initializing the ws module then the error thrown by ws
  is made available to server library
  [stopping](https://github.com/aarong/feedme-server-core#stopping) and
  [stop](https://github.com/aarong/feedme-server-core#stop) event handlers as
  `err.wsError`.

- When a client connection closes unexpectedly, the WebSocket disconnect code
  and reason are made available to server library
  [disconnect](https://github.com/aarong/feedme-server-core#disconnectg) event
  handlers as `err.wsCode` and `err.wsReason`.

- If the ws module calls back an error when attempting to send a message or a
  ping to a client then the error is made available to server library
  [disconnect](https://github.com/aarong/feedme-server-core#disconnectg) event
  handlers as `err.wsError`.

## Node.js Client

The Node.js client transport lets you connect to a Feedme API server over
Webockets from Node.js.

The Node.js client is built on top of the
[ws module](https://github.com/websockets/ws) and supports everything it does,
including HTTPS and compression. The client depends on ws version 6.2.x in order
to retain Node 6 support.

### Installation

To install the NPM package:

`npm install feedme-transport-ws`

### Initialization

To initialize a Feedme client:

```javascript
const feedmeClient = require("feedme-client");
const feedmeTransportWs = require("feedme-transport-ws/client");

const client = feedmeClient({
  transport: feedmeTransportWs(address, options);
});
```

Transport factory function arguments:

- `address` - Required string. The server WebSocket URL (ws://...)

- `options` Optional object. The object is passed to the ws module and can be
  used to configure the underlying WebSocket client. See the
  [ws documentation](https://github.com/websockets/ws/blob/master/doc/ws.md#new-websocketaddress-protocols-options)
  for options.

  The Node transport client also incorporates a heartbeat system, which can be
  configured using:

  - `options.heartbeatIntervalMs` - Optional non-negative integer. Defaults
    to 5000.

    Specifies how often to send a WebSocket ping to the server to ensure
    responsiveness.

    If set to 0, then the client will not ping the server.

  - `options.heartbeatTimeoutMs` - Optional positive integer. Defaults to 4999.

    Specifies how long to wait after pinging the server until the connection is
    considered to have been lost.

    Must be strictly less than `options.heartbeatIntervalMs` if specified.

Errors thrown:

- `err.message === "INVALID_ARGUMENT"`

  There was a problem with one or more of the supplied arguments.

### WebSocket Errors

The transport makes the following ws-level error information available via the
Feedme client library.

- If there is a problem initializing the ws module then the error thrown by ws
  is made available to client library
  [disconnect]((https://github.com/aarong/feedme-client#disconnect) event
  handlers as `err.wsError`.

- If the connection closes unexpectedly, the WebSocket disconnect code and
  reason are made available to client library
  [disconnect](https://github.com/aarong/feedme-client#disconnect) event
  handlers as `err.wsCode` and `err.wsReason`.

- If the ws module calls back an error when attempting to send a message or a
  ping to the server then the error is made available to client library
  [disconnect]((https://github.com/aarong/feedme-client#disconnect) event
  handlers as `err.wsError`.

## Browser Client

The browser client transport lets you connect to a Feedme API server over
Webockets using the native WebSocket implementation available in the browser.

Unlike the Node.js client, the browser client does not have a heartbeat feature
because browser WebSocket implementations do not expose a ping API. Heartbeat
functionality is left to the browser.

### Installation

To install the NPM package:

`npm install feedme-transport-ws`

To access using a CDN:

```html
<script
  type="text/javascript"
  src="https://cdn.jsdelivr.net/npm/feedme-transport-ws"
></script>
```

The module is named `feedmeTransportWs` in the global scope.

### Initialization

To initialize a Feedme client:

```javascript
const feedmeClient = require("feedme-client");
const feedmeTransportWs = require("feedme-transport-ws/browser");

const client = feedmeClient({
  transport: feedmeTransportWs(address);
});
client.connect();
```

Transport factory function arguments:

- `address` - Required string. The server WebSocket URL.

Errors thrown:

- `err.message === "INVALID_ARGUMENT"`

  There was a problem with one or more of the supplied arguments.

- `err.message === "NO_WEBSOCKETS"`

  There is no WebSocket implementation available.

### WebSocket Errors

The transport makes the following WebSocket-level error information available
via the Feedme client library.

- If an error is thrown when initializing a WebSocket object then the error is
  made available to client library
  [disconnect]((https://github.com/aarong/feedme-client#disconnect) event
  handlers as `err.wsError`.

- If the connection closes unexpectedly, the WebSocket disconnect code and
  reason are made available to client library
  [disconnect](https://github.com/aarong/feedme-client#disconnect) event
  handlers as `err.wsCode` and `err.wsReason`.

- If an error is thrown when attempting to send a message to the server then the
  error is made available to client library
  [disconnect]((https://github.com/aarong/feedme-client#disconnect) event
  handlers as `err.wsError`.

## Compatibility

The server module should be compatible be with third-party WebSocket client
transports that:

1. Specify either no WebSocket subprotocol or a `feedme` subprotocol.

2. Transmit Feedme messages by sending a single string across the WebSocket.

3. Do not transmit anything else on the WebSocket.

The client module should be compatible with third-party WebSocket server
transports that:

1. Accept connections with a `feedme` WebSocket subprotocol.

2. Transmit Feedme messages by sending a single string across the WebSocket.

3. Do not transmit anything else on the WebSocket.
