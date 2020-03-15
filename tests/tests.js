/*

Client tests run on Node and in the browser.
Expects feedmeTransportWsClient in scope.

*/

describe("Server test", function() {
  it("should work", function(done) {
    var PORT = 3000;
    var URL;

    // Local host for Node tests, testingserver for browser test (so they work in Sauce)
    if (typeof module !== "undefined") {
      URL = "ws://localhost:" + PORT + "/lol";
    } else {
      URL = "ws://testinghost.com:" + PORT + "/lol";
    }

    var c = feedmeTransportWsClient(URL);
    c.on("connecting", function() {
      //expect("connecting").toBe("connecting2");
    });
    c.on("connect", function() {
      //expect("connect").toBe("connect2");
      c.send("ola");
    });
    c.on("message", function(msg) {
      console.log("Client received: " + msg);
      expect("message").toBe("message");
      done();
    });
    c.on("disconnect", function(err) {});
    c.connect();
  });
  it("should", function() {
    expect(1).toBe(1);
  });
});
