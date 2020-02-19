/*

Client tests run on Node and in the browser.
Expects feedmeTransportWsClient in scope.

*/

describe("Server test", function() {
  it("should work", function(done) {
    var PORT = 3000;
    var URL = "ws://localhost:" + PORT + "/lol";
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
});
