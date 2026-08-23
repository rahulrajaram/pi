import { describe, expect, it } from "vitest";
import { ParseError, parse } from "../src/parser.ts";
import { TokenizeError, tokenize } from "../src/tokenizer.ts";

describe("invalid syntax", () => {
	describe("tokenizer errors", () => {
		it("rejects letters", () => {
			expect(() => tokenize("a")).toThrow(TokenizeError);
		});

		it("rejects unknown symbols", () => {
			expect(() => tokenize("1 @ 2")).toThrow(TokenizeError);
		});

		it("includes position in tokenizer error", () => {
			try {
				tokenize("1 + $");
				expect.fail("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(TokenizeError);
				expect((err as TokenizeError).position).toBe(4);
				expect((err as Error).message).toContain("position 4");
			}
		});
	});

	describe("parser errors", () => {
		it("rejects empty input", () => {
			expect(() => parse(tokenize(""))).toThrow(ParseError);
		});

		it("rejects trailing operator", () => {
			expect(() => parse(tokenize("1 +"))).toThrow(ParseError);
		});

		it("rejects leading operator", () => {
			expect(() => parse(tokenize("+ 1"))).toThrow(ParseError);
		});

		it("rejects missing closing paren", () => {
			expect(() => parse(tokenize("(1 + 2"))).toThrow(ParseError);
		});

		it("rejects missing opening paren", () => {
			expect(() => parse(tokenize("1 + 2)"))).toThrow(ParseError);
		});

		it("rejects empty parentheses", () => {
			expect(() => parse(tokenize("()"))).toThrow(ParseError);
		});

		it("rejects double operators", () => {
			expect(() => parse(tokenize("1 + * 2"))).toThrow(ParseError);
		});

		it("rejects unexpected token after valid expression", () => {
			expect(() => parse(tokenize("1 2"))).toThrow(ParseError);
		});

		it("includes position in parser error", () => {
			try {
				parse(tokenize("1 + * 2"));
				expect.fail("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(ParseError);
				expect((err as ParseError).position).toBe(4);
			}
		});
	});
});
