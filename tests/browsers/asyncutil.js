// Create a promise that resolves the next time an event is emitted
// Returns event arguments as an array
const once = (obj, evt) =>
  new Promise(resolve => {
    obj.once(evt, (...args) => {
      resolve([...args]);
    });
  });

// Create a promise that resolves after a specified number of milliseconds
const aSetTimeout = ms =>
  new Promise(resolve => {
    setTimeout(resolve, ms);
  });

// Create a promise that resolves next tick
const nextTick = () =>
  new Promise(resolve => {
    process.nextTick(resolve);
  });

// Create a promise that resolves/rejects on callback
// const callback = (fn, ...args) =>
//   new Promise((resolve, reject) => {
//     fn(...args, (err, ...cbArgs) => {
//       if (err) {
//         reject(err);
//       } else {
//         resolve([...cbArgs]);
//       }
//     });
//   });

// // Create a promise that resolves when the next event fires from some set
// // Returns array including event name and arguments
// const nextEvent = (obj, ...evts) =>
//   new Promise(resolve => {
//     const handlers = []; // Array of [evt, handler]
//     evts.forEach(evt => {
//       const handler = (...args) => {
//         // Remove all handlers
//         handlers.forEach(h => {
//           obj.removeListener(h[0], h[1]);
//         });
//         // Resolve the promise
//         resolve([evt, ...args]);
//       };
//       handlers.push([evt, handler]);
//       obj.on(evt, handler);
//     });
//   });

const timeout = (asyncFn, ms) =>
  new Promise((resolve, reject) => {
    setTimeout(() => {
      // No effect if called after function returns
      reject(new Error("TIMEOUT: The async function timed out."));
    }, ms);
    asyncFn()
      .then(v => {
        resolve(v);
      })
      .catch(e => {
        reject(e);
      });
  });

const exp = {
  once,
  setTimeout: aSetTimeout,
  nextTick,
  // callback,
  // nextEvent,
  timeout
};

export default exp;
