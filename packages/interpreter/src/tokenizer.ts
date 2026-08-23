export type Token =
	| { kind: "Integer"; value: number; position: number }
	| { kind: "Plus"; position: number }
	| { kind: "Minus"; position: number }
	| { kind: "Star"; position: number }
	| { kind: "Slash"; position: number }
	| { kind: "LParen"; position: number }
	| { kind: "RParen"; position: number }
	| { kind: "EOF"; position: number };

export class TokenizeError extends Error {
	position: number;
	source: string;
	constructor(position: number, source: string) {
		super(`Unexpected character at position ${position}: '${source[position] ?? "<end>"}'`);
		this.position = position;
		this.source = source;
	}
}

export function tokenize(source: string): Token[] {
	const tokens: Token[] = [];
	let pos = 0;

	while (pos < source.length) {
		const ch = source[pos];

		if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
			pos++;
			continue;
		}

		if (ch >= "0" && ch <= "9") {
			let value = 0;
			const start = pos;
			while (pos < source.length && source[pos] >= "0" && source[pos] <= "9") {
				value = value * 10 + (source[pos].charCodeAt(0) - "0".charCodeAt(0));
				pos++;
			}
			tokens.push({ kind: "Integer", value, position: start });
			continue;
		}

		switch (ch) {
			case "+":
				tokens.push({ kind: "Plus", position: pos });
				break;
			case "-":
				tokens.push({ kind: "Minus", position: pos });
				break;
			case "*":
				tokens.push({ kind: "Star", position: pos });
				break;
			case "/":
				tokens.push({ kind: "Slash", position: pos });
				break;
			case "(":
				tokens.push({ kind: "LParen", position: pos });
				break;
			case ")":
				tokens.push({ kind: "RParen", position: pos });
				break;
			default:
				throw new TokenizeError(pos, source);
		}
		pos++;
	}

	tokens.push({ kind: "EOF", position: pos });
	return tokens;
}
