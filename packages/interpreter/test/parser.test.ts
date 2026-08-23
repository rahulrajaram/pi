import { describe, expect, it } from "vitest";
import type { Expr } from "../src/ast.ts";
import { parse } from "../src/parser.ts";
import { tokenize } from "../src/tokenizer.ts";

function astString(expr: Expr): string {
	switch (expr.kind) {
		case "IntegerLiteral":
			return `Integer(${expr.value})`;
		case "Binary":
			return `Binary('${expr.operator}', ${astString(expr.left)}, ${astString(expr.right)})`;
	}
}

describe("parser", () => {
	it("parses a single integer", () => {
		const ast = parse(tokenize("42"));
		expect(astString(ast)).toMatchInlineSnapshot(`"Integer(42)"`);
	});

	it("parses addition", () => {
		const ast = parse(tokenize("1 + 2"));
		expect(astString(ast)).toMatchInlineSnapshot(`"Binary('+', Integer(1), Integer(2))"`);
	});

	it("parses subtraction", () => {
		const ast = parse(tokenize("5 - 3"));
		expect(astString(ast)).toMatchInlineSnapshot(`"Binary('-', Integer(5), Integer(3))"`);
	});

	it("parses multiplication", () => {
		const ast = parse(tokenize("4 * 5"));
		expect(astString(ast)).toMatchInlineSnapshot(`"Binary('*', Integer(4), Integer(5))"`);
	});

	it("parses division", () => {
		const ast = parse(tokenize("8 / 2"));
		expect(astString(ast)).toMatchInlineSnapshot(`"Binary('/', Integer(8), Integer(2))"`);
	});

	it("respects precedence: multiplication before addition", () => {
		const ast = parse(tokenize("1 + 2 * 3"));
		expect(astString(ast)).toMatchInlineSnapshot(`"Binary('+', Integer(1), Binary('*', Integer(2), Integer(3)))"`);
	});

	it("respects precedence: division before subtraction", () => {
		const ast = parse(tokenize("10 - 6 / 2"));
		expect(astString(ast)).toMatchInlineSnapshot(`"Binary('-', Integer(10), Binary('/', Integer(6), Integer(2)))"`);
	});

	it("chains left-associative operators", () => {
		const ast = parse(tokenize("10 - 3 - 2"));
		expect(astString(ast)).toMatchInlineSnapshot(`"Binary('-', Binary('-', Integer(10), Integer(3)), Integer(2))"`);
	});

	it("parses parentheses", () => {
		const ast = parse(tokenize("(1 + 2) * 3"));
		expect(astString(ast)).toMatchInlineSnapshot(`"Binary('*', Binary('+', Integer(1), Integer(2)), Integer(3))"`);
	});

	it("parses nested parentheses", () => {
		const ast = parse(tokenize("((1 + 2) * (3 + 4))"));
		expect(astString(ast)).toMatchInlineSnapshot(
			`"Binary('*', Binary('+', Integer(1), Integer(2)), Binary('+', Integer(3), Integer(4)))"`,
		);
	});

	it("ignores whitespace", () => {
		const ast = parse(tokenize("  1  +   2  "));
		expect(astString(ast)).toMatchInlineSnapshot(`"Binary('+', Integer(1), Integer(2))"`);
	});

	it("parses complex expression", () => {
		const ast = parse(tokenize("1 + 2 * 3 - 4 / 5"));
		expect(astString(ast)).toMatchInlineSnapshot(
			`"Binary('-', Binary('+', Integer(1), Binary('*', Integer(2), Integer(3))), Binary('/', Integer(4), Integer(5)))"`,
		);
	});
});
