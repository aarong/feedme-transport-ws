import feedmeClient from "feedme-client";
import feedmeServerCore from "feedme-server-core";
import promisifyEvent from "promisify-event";
import transportWsServer from "../../build/server";
import transportWsClient from "../../build/client";

/*

End-to-end test of key Feedme client-server functionality.

*/

let nextPortNumber = 4500; // Avoid conflicts across test suites
const getNextPortNumber = () => {
  nextPortNumber += 1;
  return nextPortNumber - 1;
};

it("should work through all major operations", async () => {
  const port = getNextPortNumber();

  // Start a Feedme server
  const fmServer = feedmeServerCore({
    transport: transportWsServer({ port })
  });
  fmServer.start();
  await promisifyEvent(fmServer, "start");

  // Connect a Feedme client
  const fmClient = feedmeClient({
    transport: transportWsClient(`ws://localhost:${port}`),
    reconnect: false
  });
  fmClient.connect();
  await promisifyEvent(fmClient, "connect");

  // Try a rejected action
  fmServer.once("action", (areq, ares) => {
    ares.failure("SOME_ERROR", { Error: "Data" });
  });
  try {
    await fmClient.action("SomeAction", {
      Action: "Args"
    });
  } catch (e) {
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe("REJECTED: Server rejected the action request.");
    expect(e.serverErrorCode).toBe("SOME_ERROR");
    expect(e.serverErrorData).toEqual({ Error: "Data" });
  }

  // Try a successful action
  fmServer.once("action", (areq, ares) => {
    ares.success({ Action: "Data" });
  });
  const actionData = await fmClient.action("SomeAction", { Action: "Args" });
  expect(actionData).toEqual({ Action: "Data" });

  // Try a rejected feed open
  fmServer.once("feedOpen", (foreq, fores) => {
    fores.failure("SOME_ERROR", { Error: "Data" });
  });
  const feed = fmClient.feed("SomeFeed", { Feed: "Args" });
  feed.desireOpen();
  feed.once("close", err => {
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe(
      "REJECTED: Server rejected the feed open request."
    );
    expect(err.serverErrorCode).toBe("SOME_ERROR");
    expect(err.serverErrorData).toEqual({ Error: "Data" });
  });
  await promisifyEvent(feed, "close");
  feed.desireClosed();

  // Try a successful feed open
  fmServer.once("feedOpen", (foreq, fores) => {
    fores.success({ Feed: "Data" });
  });
  feed.desireOpen();
  feed.once("open", () => {
    expect(feed.data()).toEqual({ Feed: "Data" });
  });
  await promisifyEvent(feed, "open");

  // Try a feed closure
  feed.once("close", err => {
    expect(err).toBe(undefined);
  });
  feed.desireClosed();
  fmServer.once("feedClose", (fcreq, fcres) => {
    fcres.success(); // Needed because you attach a listener to the event
  });
  await promisifyEvent(fmServer, "feedClose");

  // Try an action revelation
  fmServer.once("feedOpen", (foreq, fores) => {
    fores.success({ Feed: "Data" });
  });
  feed.desireOpen();
  await promisifyEvent(feed, "open");
  fmServer.actionRevelation({
    actionName: "SomeAction",
    actionData: { Action: "Data" },
    feedName: "SomeFeed",
    feedArgs: { Feed: "Args" },
    feedDeltas: [{ Operation: "Append", Path: ["Feed"], Value: "New" }]
  });
  feed.once("action", (an, ad, nfd, ofd) => {
    expect(an).toBe("SomeAction");
    expect(ad).toEqual({ Action: "Data" });
    expect(nfd).toEqual({ Feed: "DataNew" });
    expect(ofd).toEqual({ Feed: "Data" });
  });
  await promisifyEvent(feed, "action");

  // Try a feed termination
  fmServer.feedTermination({
    feedName: "SomeFeed",
    feedArgs: { Feed: "Args" },
    errorCode: "SOME_ERROR",
    errorData: { Error: "Data" }
  });
  feed.once("close", err => {
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("TERMINATED: The server terminated the feed.");
    expect(err.serverErrorCode).toBe("SOME_ERROR");
    expect(err.serverErrorData).toEqual({ Error: "Data" });
  });
  await promisifyEvent(feed, "close");

  // Try a server disconnect
  fmServer.disconnect(fmClient.id());
  fmClient.once("disconnect", err => {
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("FAILURE: The WebSocket closed unexpectedly.");
  });
  await promisifyEvent(fmClient, "disconnect");

  // Try a client disconnect
  fmClient.connect();
  await promisifyEvent(fmClient, "connect");
  const clientId = fmClient.id();
  fmServer.once("disconnect", (cid, err) => {
    expect(cid).toBe(clientId);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("FAILURE: WebSocket transmission failed.");
  });
  fmClient.disconnect();
  await promisifyEvent(fmServer, "disconnect");

  // Try a server stoppage (also cleans up)
  fmClient.connect();
  await promisifyEvent(fmClient, "connect");
  fmServer.stop();
  fmClient.once("disconnect", err => {
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("FAILURE: The WebSocket closed unexpectedly.");
  });
  await promisifyEvent(fmClient, "disconnect");
});
