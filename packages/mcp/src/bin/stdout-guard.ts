/**
 * stdout belongs to the protocol: one stray `console.log` — ours or a
 * dependency's — corrupts the JSON-RPC stream and the client disconnects with
 * an unhelpful error. Imported first by the stdio binary, so it runs before
 * any module that might log while loading (modules evaluate in import order).
 */
console.log = (...args: unknown[]) => console.error(...args);
console.info = (...args: unknown[]) => console.error(...args);
console.debug = (...args: unknown[]) => console.error(...args);
