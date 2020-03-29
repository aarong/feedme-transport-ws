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
      fmControllerClient.action("CreateServer", {}, function(err, actionData) {
        console.log(err, actionData);
        var eventFeed = fmControllerClient.feed("Events", {
          ServerId: actionData.ServerId
        });
        eventFeed.on("action", function(actionName, actionData) {
          console.log("GOT ACTION" + actionName, actionData);
          if (actionData.EventName === "start") {
            expect(1).toBe(1);
            done();
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
