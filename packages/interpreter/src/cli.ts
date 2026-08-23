#!/usr/bin/env node
import { evaluate, RuntimeError } from "./evaluator.ts";
import { ParseError, parse } from "./parser.ts";
import { TokenizeError, tokenize } from "./tokenizer.ts";

function main(args: string[]): void {
	if (args.length === 0) {
		console.error('Usage: pi-interpreter "<expression>"');
		console.error('Example: pi-interpreter "(1 + 2) * 3"');
		process.exit(1);
	}

	const input = args.join(" ");
	try {
		const tokens = tokenize(input);
		const ast = parse(tokens);
		const result = evaluate(ast);
		console.log(result);
	} catch (err) {
		if (err instanceof TokenizeError || err instanceof ParseError || err instanceof RuntimeError) {
			console.error(`Error: ${err.message}`);
			process.exit(1);
		}
		throw err;
	}
}

main(process.argv.slice(2));
