import test from "node:test";
import assert from "node:assert/strict";
import { numberToWordsRupees } from "../src/lib/amount-in-words.ts";

test("formats zero", () => {
  assert.equal(numberToWordsRupees(0), "Rupees Zero Only");
});

test("formats hundreds", () => {
  assert.equal(numberToWordsRupees(1500), "Rupees One Thousand Five Hundred Only");
  assert.equal(numberToWordsRupees(999), "Rupees Nine Hundred Ninety Nine Only");
});

test("formats Indian lakh and crore units", () => {
  assert.equal(numberToWordsRupees(100000), "Rupees One Lakh Only");
  assert.equal(numberToWordsRupees(1234567), "Rupees Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven Only");
  assert.equal(numberToWordsRupees(10000000), "Rupees One Crore Only");
});

test("floors decimal amounts like the original receipt helper", () => {
  assert.equal(numberToWordsRupees(1500.99), "Rupees One Thousand Five Hundred Only");
});
