# pi-interpreter

Small expression language interpreter with a stable AST, deterministic evaluation, and a CLI.

## Features

- Integer literals
- Parentheses
- Addition, subtraction, multiplication, division
- Left-associative binary operators
- Standard precedence (`*` and `/` before `+` and `-`)

## Usage

### CLI

```bash
npx pi-interpreter "(1 + 2) * 3"
# 9
```

### Programmatic API

```typescript
import { tokenize, parse, evaluate } from '@earendil-works/pi-interpreter';

const tokens = tokenize('(1 + 2) * 3');
const ast = parse(tokens);
const result = evaluate(ast); // 9
```

## Testing

```bash
npm test
```
