import assert from "node:assert/strict";
import test from "node:test";

import { add, subtract } from "../src/calculator.ts";

test("adds two numbers", () => {
  assert.equal(add(2, 3), 5);
});

test("subtracts two numbers", () => {
  assert.equal(subtract(7, 4), 3);
});
