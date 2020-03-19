/*

Browser tests

*/

describe("Server test", function() {
  it("should work", function(done) {
    var PORT = 3000;
    var URL = "ws://testinghost.com:" + PORT + "/lol";

    var fmClient = feedmeClient({ transport: feedmeTransportWsClient(URL) });

    fmClient.on("connect", function() {
      var feed = fmClient.feed("SomeFeed", { feed: "args" });
      feed.on("open", function() {
        expect(1).toBe(1);
        done();
        console.log(feed.data());
        setInterval(function() {
          fmClient.action("SomeAction", { action: "args" }, function(
            err,
            actionData
          ) {
            console.log(err, actionData);
          });
        }, 1000);

        feed.on("action", function(an, aa, fd, ofd) {
          console.log(fd);
        });
      });

      feed.desireOpen();
    });

    fmClient.connect();
  });
});
