// Notepad for one Analyze -> Fill round. The live DOM stays the authority.
export function createRegistry() {
  const els = new Map();
  const prints = new Map();
  let generation = 0;
  return {
    reset() {
      generation++;
      els.clear();
      prints.clear();
    },
    add(el, print) {
      const ref = `f${generation}-${els.size + 1}`;
      els.set(ref, el);
      prints.set(ref, print);
      return ref;
    },
    resolve(ref) {
      const el = els.get(ref);
      return el && el.isConnected ? el : null;
    },
    fingerprintOf: (ref) => prints.get(ref) || null,
    rebind: (ref, el) => els.set(ref, el),
    entries: () => [...els],
  };
}
