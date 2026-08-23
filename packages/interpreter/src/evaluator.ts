import type { Expr } from "./ast.ts";

export class RuntimeError extends Error {
	constructor(message: string) {
		super(message);
	}
}

export function evaluate(expr: Expr): number {
	switch (expr.kind) {
		case "IntegerLiteral":
			return expr.value;
		case "Binary": {
			const left = evaluate(expr.left);
			const right = evaluate(expr.right);
			switch (expr.operator) {
				case "+":
					return left + right;
				case "-":
					return left - right;
				case "*":
					return left * right;
				case "/":
					if (right === 0) {
						throw new RuntimeError("Division by zero");
					}
					return left / right;
			}
		}
	}
}
