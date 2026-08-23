import type { Expr } from "./ast.ts";
import { binary, integerLiteral } from "./ast.ts";
import type { Token } from "./tokenizer.ts";

export class ParseError extends Error {
	position: number;
	constructor(message: string, position: number) {
		super(message);
		this.position = position;
	}
}

class Parser {
	private pos = 0;
	private tokens: Token[];

	constructor(tokens: Token[]) {
		this.tokens = tokens;
	}

	parse(): Expr {
		const expr = this.expr();
		const eof = this.tokens[this.pos];
		if (eof.kind !== "EOF") {
			throw new ParseError(`Unexpected token '${this.tokenText(eof)}'`, eof.position);
		}
		return expr;
	}

	private expr(): Expr {
		let left = this.term();
		while (true) {
			const tok = this.tokens[this.pos];
			if (tok.kind === "Plus") {
				this.pos++;
				left = binary("+", left, this.term());
			} else if (tok.kind === "Minus") {
				this.pos++;
				left = binary("-", left, this.term());
			} else {
				break;
			}
		}
		return left;
	}

	private term(): Expr {
		let left = this.factor();
		while (true) {
			const tok = this.tokens[this.pos];
			if (tok.kind === "Star") {
				this.pos++;
				left = binary("*", left, this.factor());
			} else if (tok.kind === "Slash") {
				this.pos++;
				left = binary("/", left, this.factor());
			} else {
				break;
			}
		}
		return left;
	}

	private factor(): Expr {
		const tok = this.tokens[this.pos];
		if (tok.kind === "Integer") {
			this.pos++;
			return integerLiteral(tok.value);
		}
		if (tok.kind === "LParen") {
			this.pos++;
			const inner = this.expr();
			const next = this.tokens[this.pos];
			if (next.kind !== "RParen") {
				throw new ParseError(`Expected ')' but found '${this.tokenText(next)}'`, next.position);
			}
			this.pos++;
			return inner;
		}
		throw new ParseError(`Unexpected token '${this.tokenText(tok)}'`, tok.position);
	}

	private tokenText(tok: Token): string {
		switch (tok.kind) {
			case "Integer":
				return String(tok.value);
			case "Plus":
				return "+";
			case "Minus":
				return "-";
			case "Star":
				return "*";
			case "Slash":
				return "/";
			case "LParen":
				return "(";
			case "RParen":
				return ")";
			case "EOF":
				return "<end>";
		}
	}
}

export function parse(tokens: Token[]): Expr {
	return new Parser(tokens).parse();
}
