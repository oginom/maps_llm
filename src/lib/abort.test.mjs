import assert from "node:assert/strict";
import test from "node:test";
import { isClientAbort } from "./abort.ts";

test("recognises AbortError, Next.js ResponseAborted and an aborted signal", () => {
  assert.equal(isClientAbort(new DOMException("aborted", "AbortError")), true);
  // Next.js aborts request.signal with `new ResponseAborted()`; undici's
  // fetch rejects with that plain object as the reason.
  class ResponseAborted extends Error {
    name = "ResponseAborted";
  }
  assert.equal(isClientAbort(new ResponseAborted()), true);
  const controller = new AbortController();
  controller.abort(new ResponseAborted());
  assert.equal(
    isClientAbort(new Error("fetch failed"), controller.signal),
    true,
  );
});

test("does not treat other failures as aborts", () => {
  const controller = new AbortController();
  assert.equal(
    isClientAbort(new Error("getaddrinfo ENOTFOUND"), controller.signal),
    false,
  );
  assert.equal(isClientAbort(new TypeError("fetch failed")), false);
  assert.equal(isClientAbort(undefined), false);
  assert.equal(isClientAbort("AbortError"), false);
});
