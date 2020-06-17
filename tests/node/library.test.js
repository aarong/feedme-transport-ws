import feedmeClient from "feedme-client";
import feedmeServerCore from "feedme-server-core";
import transportWsServer from "../../build/server";
import transportWsClient from "../../build/client";
import asyncUtil from "./asyncutil";
/*

Test the feedme-client and feedme-server-core libraries against one another.
Test that all application-facing client library functions trigger the right
events and state updates on the server, and vice versa.

Only testing stand-alone transport server.

*/

let nextPortNumber = 4500; // Avoid conflicts across test suites
const getNextPortNumber = () => {
  nextPortNumber += 1;
  return nextPortNumber - 1;
};

describe("something", () => {
  it("should", async () => {
    const port = getNextPortNumber();

    // Start a Feedme server
    const fmServer = feedmeServerCore({
      transport: transportWsServer({ port })
    });
    fmServer.start();
    await asyncUtil.once(fmServer, "start");

    // Connect a Feedme client
    const fmClient = feedmeClient({
      transport: transportWsClient(`ws://localhost:${port}`)
    });
    fmClient.connect();
    await asyncUtil.once(fmClient, "connect");

    console.log(fmClient.state());
  });
});
