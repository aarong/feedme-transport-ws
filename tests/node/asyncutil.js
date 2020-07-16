// Create a promise that resolves the next time an event is emitted
const once = (obj, evt) =>
  new Promise(resolve => {
    obj.once(evt, resolve);
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

const exp = {
  once,
  setTimeout: aSetTimeout,
  nextTick
  // callback
};

export default exp;
