// Saves the last thing it was handed, once typing has stopped. Kept apart
// from React so that the rule — one save per pause, never one per keystroke —
// can be tested without a component.
export function createAutosave({ delay = 800, save }) {
  let timer = null;
  let waiting = null; // the payload a scheduled save would write

  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const run = async () => {
    if (waiting === null) return;
    const payload = waiting;
    waiting = null;
    clear();
    await save(payload);
  };

  return {
    schedule(payload) {
      waiting = payload;
      clear();
      timer = setTimeout(run, delay);
    },
    flush: run,
    cancel() {
      waiting = null;
      clear();
    },
    pending() {
      return waiting !== null;
    },
  };
}
