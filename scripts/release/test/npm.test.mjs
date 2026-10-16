import assert from "node:assert/strict";
import { test } from "node:test";

import { interpretView } from "../npm.mjs";

const view = (code, stdout, stderr = "") =>
  interpretView({ code, stdout, stderr }, "@indexyz/pi-skill", "0.1.44");

test("a successful response confirming the version means present", () => {
  assert.equal(view(0, '"0.1.44"\n'), true);
  assert.equal(view(0, '["0.1.43","0.1.44"]\n'), true);
});

test("a 404 means absent", () => {
  assert.equal(
    view(1, "", "npm error code E404\nnpm error 404 No match found for version 0.1.44\n"),
    false,
  );
});

test("an empty or unexpected successful response is an error, not absence", () => {
  for (const stdout of ["", "{}", "[]", '"9.9.9"', "not json"]) {
    assert.throws(() => view(0, stdout), /unexpected response/, `stdout ${JSON.stringify(stdout)}`);
  }
});

test("any other failure is an error, not absence", () => {
  assert.throws(() => view(1, "", "npm error code E401\nnpm error 401 Unauthorized\n"), /E401/);
  assert.throws(() => view(-1, "", "spawn npm ENOENT"), /ENOENT/);
});
