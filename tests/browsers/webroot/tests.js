/*

Browser functional tests.

*/

describe("Server test", function() {
  it("should work", function(done) {
    var PORT = 3000;
    var URL = "ws://testinghost.com:" + PORT + "/feedme/controller";
    var fmControllerClient = feedmeClient({
      transport: feedmeTransportWsClient(URL)
    });
    fmControllerClient.on("connect", function() {
      fmControllerClient.action("CreateTransportServer", {}, function(
        err,
        actionData
      ) {
        // Listen for transport server events
        var eventFeed = fmControllerClient.feed("Events", {
          Port: actionData.Port + ""
        });
        eventFeed.on("action", function(actionName, actionData) {
          console.log("GOT ACTION" + actionName, actionData);
          if (actionData.EventName === "start") {
            // Try to connect to the transport server
            console.log("trying to connect");
            var client = feedmeTransportWsClient("ws://localhost:4000");
            client.on("connect", function() {
              expect(1).toBe(1);
              done();
            });
            client.on("disconnect", function() {
              console.log("DISCONNECT", arguments);
            });
            client.connect();
          }
        });
        eventFeed.desireOpen();
      });
      // var feed = fmControllerClient.feed("SomeFeed", { feed: "args" });
      // feed.on("open", function() {
      //   expect(1).toBe(1);
      //   done();
      //   console.log(feed.data());
      //   setInterval(function() {
      //     fmControllerClient.action("SomeAction", { action: "args" }, function(
      //       err,
      //       actionData
      //     ) {
      //       console.log(err, actionData);
      //     });
      //   }, 1000);
      //   feed.on("action", function(an, aa, fd, ofd) {
      //     console.log(fd);
      //   });
      // });
      // feed.desireOpen();
    });
    fmControllerClient.connect();
  });
});
