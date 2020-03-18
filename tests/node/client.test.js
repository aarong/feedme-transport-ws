import async from "async";
import WebSocket from "ws";
import transportWsServer from "../../build/server";
import transportWsClient from "../../build/client";

/*

Build integration/functional tests for the Node client.

- Tests client transport against API requirements in feedme-client DEV (against transport server)
  - Library-initiated functionality
  - WebSocket-initiated functionality
- Tests client transport against API documentation in README (against transport server)
  - Library-initiated functionality
  - WebSocket-initiated functionality
- Tests client transport directly against WebSocket server (no transport)
  - Things like terminate()

Check everything both sync and async?

*/

describe("Transport client vs transport server", () => {
  it("Sample test", done => {
    let s;
    let cid;
    let c;

    async.series(
      [
        cb => {
          // Set up the server - started
          s = transportWsServer({ port: 8080 });
          s.on("start", cb);
          s.on("connect", id => {
            cid = id;
          });
          s.start();
        },
        cb => {
          // Set up the client - connected
          c = transportWsClient("ws://localhost:8080");
          c.on("connect", cb);
          c.connect();
        },
        cb => {
          // Run the test
          c.on("disconnect", err => {
            expect(1).toBe(1);
            console.log(err);
            cb();
          });
          s.disconnect(cid);
        }
      ],
      () => {
        // Clean up - client already disconnected
        s.stop();
        done();
      }
    );
  });
});

describe("Transport client vs raw WebSocket server", () => {
  it("Sample test", done => {
    let wss;
    let wsc;
    let c;

    async.series(
      [
        cb => {
          // Set up the server - started
          wss = new WebSocket.Server({ port: 8080 });
          wss.on("listening", cb);
          wss.on("connection", w => {
            wsc = w;
          });
        },
        cb => {
          // Set up the client - connected
          c = transportWsClient("ws://localhost:8080");
          c.on("connect", cb);
          c.connect();
        },
        cb => {
          // Run the test
          c.on("disconnect", err => {
            expect(1).toBe(1);
            console.log(err);
            cb();
          });
          wsc.terminate();
        }
      ],
      () => {
        // Clean up - client already disconnected
        wss.close();
        done();
      }
    );
  });
});
