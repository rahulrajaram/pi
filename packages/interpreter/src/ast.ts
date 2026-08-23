export type Expr =
	| { kind: "IntegerLiteral"; value: number }
	| { kind: "Binary"; operator: "+" | "-" | "*" | "/"; left: Expr; right: Expr };

export function integerLiteral(value: number): Expr {
	return { kind: "IntegerLiteral", value };
}

export function binary(operator: "+" | "-" | "*" | "/", left: Expr, right: Expr): Expr {
	return { kind: "Binary", operator, left, right };
}
