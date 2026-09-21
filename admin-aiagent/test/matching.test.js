import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveByName, NameResolutionError } from "../src/matching.js";

const items = [{ title: "Blue T-Shirt" }, { title: "Red T-Shirt" }, { title: "Blue Hoodie" }];
const getName = (item) => item.title;

test("exact match wins over substring matches", () => {
  const result = resolveByName(items, "Blue T-Shirt", getName);
  assert.equal(result.title, "Blue T-Shirt");
});

test("exact match is case-insensitive", () => {
  const result = resolveByName(items, "blue t-shirt", getName);
  assert.equal(result.title, "Blue T-Shirt");
});

test("falls back to a unique substring match", () => {
  const result = resolveByName(items, "Hoodie", getName);
  assert.equal(result.title, "Blue Hoodie");
});

test("throws when there is no match at all", () => {
  assert.throws(() => resolveByName(items, "Nonexistent", getName), NameResolutionError);
});

test("throws instead of guessing when multiple substring matches tie", () => {
  assert.throws(() => resolveByName(items, "Blue", getName), NameResolutionError);
});

test("throws instead of guessing when multiple exact matches tie", () => {
  const duplicates = [{ title: "Downtown" }, { title: "downtown" }];
  assert.throws(() => resolveByName(duplicates, "Downtown", getName), NameResolutionError);
});
