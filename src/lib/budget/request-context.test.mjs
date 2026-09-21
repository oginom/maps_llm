import assert from "node:assert/strict";
import test from "node:test";
import { parseBudgetContext } from "./request-context.ts";

const SESSION = "11111111-1111-4111-8111-111111111111";
const RUN = "22222222-2222-4222-8222-222222222222";

test("valid UUID v4 headers are accepted and lower-cased", () => {
  const parsed = parseBudgetContext(
    new Headers({ "X-Session-Id": SESSION.toUpperCase(), "x-run-id": RUN }),
  );
  assert.deepEqual(parsed, {
    ok: true,
    context: { sessionId: SESSION, runId: RUN },
  });
});

test("missing or malformed ids are rejected with the header name", () => {
  const missing = parseBudgetContext(new Headers({ "X-Session-Id": SESSION }));
  assert.equal(missing.ok, false);
  assert.match(missing.message, /^入力が不正です: X-Run-Id/);

  const notV4 = parseBudgetContext(
    new Headers({
      "X-Session-Id": "11111111-1111-1111-8111-111111111111",
      "X-Run-Id": RUN,
    }),
  );
  assert.equal(notV4.ok, false);
  assert.match(notV4.message, /X-Session-Id/);
  assert.doesNotMatch(notV4.message, /X-Run-Id/);

  const junk = parseBudgetContext(
    new Headers({ "X-Session-Id": "abc", "X-Run-Id": "../etc" }),
  );
  assert.equal(junk.ok, false);
  assert.match(junk.message, /X-Session-Id/);
  assert.match(junk.message, /X-Run-Id/);

  assert.equal(parseBudgetContext(new Headers()).ok, false);
});
