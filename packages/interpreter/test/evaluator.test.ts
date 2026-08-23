import { describe, expect, it } from "vitest";
import { evaluate, RuntimeError } from "../src/evaluator.ts";
import { parse } from "../src/parser.ts";
import { tokenize } from "../src/tokenizer.ts";

function evalExpr(source: string): number {
	return evaluate(parse(tokenize(source)));
}

describe("evaluator", () => {
	it("evaluates a single integer", () => {
		expect(evalExpr("42")).toBe(42);
	});

	it("evaluates addition", () => {
		expect(evalExpr("1 + 2")).toBe(3);
	});

	it("evaluates subtraction", () => {
		expect(evalExpr("5 - 3")).toBe(2);
	});

	it("evaluates multiplication", () => {
		expect(evalExpr("4 * 5")).toBe(20);
	});

	it("evaluates division", () => {
		expect(evalExpr("8 / 2")).toBe(4);
	});

	it("evaluates fractional division", () => {
		expect(evalExpr("5 / 2")).toBe(2.5);
	});

	it("respects precedence", () => {
		expect(evalExpr("1 + 2 * 3")).toBe(7);
	});

	it("respects parentheses", () => {
		expect(evalExpr("(1 + 2) * 3")).toBe(9);
	});

	it("chains left-associative addition", () => {
		expect(evalExpr("1 + 2 + 3")).toBe(6);
	});

	it("chains left-associative subtraction", () => {
		expect(evalExpr("10 - 3 - 2")).toBe(5);
	});

	it("chains left-associative multiplication", () => {
		expect(evalExpr("2 * 3 * 4")).toBe(24);
	});

	it("chains left-associative division", () => {
		expect(evalExpr("24 / 4 / 2")).toBe(3);
	});

	it("evaluates complex expression", () => {
		expect(evalExpr("(100 + 200) * 3 - 400 / (2 + 2)")).toBe(800);
	});

	it("throws on division by zero", () => {
		expect(() => evalExpr("1 / 0")).toThrow(RuntimeError);
		expect(() => evalExpr("1 / 0")).toThrow("Division by zero");
	});

	it("evaluates negative result", () => {
		expect(evalExpr("3 - 10")).toBe(-7);
	});

	it("evaluates zero", () => {
		expect(evalExpr("0")).toBe(0);
	});

	it("evaluates large numbers", () => {
		expect(evalExpr("999999 + 1")).toBe(1000000);
	});
});
