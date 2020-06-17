import async from "async";
import transportWsServer from "../../build/server";
import transportWsClient from "../../build/client";

/*

Test the transport client and transport server against each another.

Test only that the library-facing side of the client (server) API generates the
correct events and state on the  server (client).

*/

// const EPSILON = 100;

let nextPortNumber = 4000;
const getNextPortNumber = () => {
  // Avoid port conflicts between servers across tests
  nextPortNumber += 1;
  return nextPortNumber - 1;
};

describe("Transport client vs transport server", () => {
  it("Sample test", done => {
    let s;
    let cid;
    let c;
    const port = getNextPortNumber();

    async.series(
      [
        cb => {
          // Set up the server - started
          s = transportWsServer({ port });
          s.once("start", cb);
          s.once("connect", id => {
            cid = id;
          });
          s.start();
        },
        cb => {
          // Set up the client - connected
          c = transportWsClient(`ws://localhost:${port}`);
          c.once("connect", cb);
          c.connect();
        },
        cb => {
          // Run the test
          c.once("disconnect", () => {
            expect(1).toBe(1);
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
