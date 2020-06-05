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

const exp = {
  once,
  setTimeout: aSetTimeout,
  nextTick
};

export default exp;
