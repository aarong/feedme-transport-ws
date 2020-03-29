/*

Browser functional tests.

*/

describe("Server test", function() {
  it("should work", function(done) {
    var PORT = 3000;
    var URL = "ws://testinghost.com";
    var fmControllerClient = feedmeClient({
      transport: feedmeTransportWsClient(URL + ":" + PORT)
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
        eventFeed.on("action", function(actionName, ad) {
          console.log("EVENT " + actionName, ad);
          if (ad.EventName === "start") {
            // Try to connect to the transport instance
            console.log(URL + ":" + actionData.Port);
            var transportClient = feedmeTransportWsClient(
              URL + ":" + actionData.Port
            );
            transportClient.on("connect", function() {
              console.log("done");
              done();
            });
            transportClient.connect();
          }
        });

        eventFeed.on("open", function() {
          // Try to start the transport server
          fmControllerClient.action(
            "InvokeTransportMethod",
            {
              Port: actionData.Port + 0,
              Method: "start",
              Arguments: []
            },
            function(err, ad) {
              expect(1).toBe(1);
            }
          );
        });

        eventFeed.desireOpen();
      });
    });
    fmControllerClient.connect();
  });
});

// var prom = new Promise(function(resolve, reject) {
//   setTimeout(function() {
//     //resolve("ok!!");
//     reject(new Error("junk"));
//   }, 5000);
// });

// prom
//   .then(function(result) {
//     console.log("done", result);
//   })
//   .catch(function(err) {
//     console.log("caught", err);
//   });
