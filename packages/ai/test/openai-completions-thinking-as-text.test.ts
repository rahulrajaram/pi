import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { convertMessages, stream as streamOpenAICompletions } from "../src/api/openai-completions.ts";
import type {
	AssistantMessage,
	AssistantMessageEvent,
	Context,
	Model,
	OpenAICompletionsCompat,
	Usage,
} from "../src/types.ts";

const emptyUsage: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const compat = {
	supportsStore: true,
	supportsDeveloperRole: true,
	supportsReasoningEffort: true,
	supportsUsageInStreaming: true,
	maxTokensField: "max_completion_tokens",
	requiresToolResultName: false,
	requiresAssistantAfterToolResult: false,
	requiresThinkingAsText: true,
	requiresReasoningContentOnAssistantMessages: false,
	thinkingFormat: "openai",
	openRouterRouting: {},
	vercelGatewayRouting: {},
	chatTemplateKwargs: {},
	zaiToolStream: false,
	toolCallContentFormat: undefined,
	supportsStrictMode: true,
	cacheControlFormat: undefined,
	sendSessionAffinityHeaders: false,
	sessionAffinityFormat: "openai",
	supportsLongCacheRetention: true,
} satisfies Omit<
	Required<OpenAICompletionsCompat>,
	"cacheControlFormat" | "deferredToolsMode" | "toolCallContentFormat"
> & {
	cacheControlFormat?: OpenAICompletionsCompat["cacheControlFormat"];
	deferredToolsMode?: OpenAICompletionsCompat["deferredToolsMode"];
	toolCallContentFormat?: OpenAICompletionsCompat["toolCallContentFormat"];
};

function buildModel(baseUrl = "http://127.0.0.1:1"): Model<"openai-completions"> {
	return {
		id: "repro-model",
		name: "Repro Model",
		api: "openai-completions",
		provider: "repro-provider",
		baseUrl,
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 4096,
		compat,
	};
}

function buildAssistant(content: AssistantMessage["content"]): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-completions",
		provider: "repro-provider",
		model: "repro-model",
		usage: emptyUsage,
		stopReason: "stop",
		timestamp: 2,
	};
}

function buildContext(assistant: AssistantMessage): Context {
	return {
		messages: [
			{ role: "user", content: "hello", timestamp: 1 },
			assistant,
			{ role: "user", content: "continue", timestamp: 3 },
		],
	};
}

async function collectEvents(stream: AsyncIterable<AssistantMessageEvent>): Promise<AssistantMessageEvent[]> {
	const events: AssistantMessageEvent[] = [];
	for await (const event of stream) {
		events.push(event);
	}
	return events;
}

interface ChatCompletionsRequestBody {
	model: string;
	messages: Array<{ role: string; content?: unknown }>;
	stream: boolean;
	stream_options?: { include_usage?: boolean };
}

describe("openai-completions thinking-as-text replay", () => {
	afterEach(() => {
		delete process.env.OPENAI_API_KEY;
	});

	it("serializes same-model thinking-plus-text replay as assistant text parts", () => {
		const messages = convertMessages(
			buildModel(),
			buildContext(
				buildAssistant([
					{ type: "thinking", thinking: "internal reasoning" },
					{ type: "text", text: "visible answer" },
				]),
			),
			compat,
		);

		expect(messages[1]).toEqual({
			role: "assistant",
			content: [
				{ type: "text", text: "internal reasoning" },
				{ type: "text", text: "visible answer" },
			],
		});
	});

	it("serializes same-model thinking-only replay as assistant text parts", () => {
		const messages = convertMessages(
			buildModel(),
			buildContext(buildAssistant([{ type: "thinking", thinking: "internal reasoning" }])),
			compat,
		);

		expect(messages[1]).toEqual({
			role: "assistant",
			content: [{ type: "text", text: "internal reasoning" }],
		});
	});

	it("reaches the endpoint when replay contains both thinking and text", async () => {
		const requestBodies: ChatCompletionsRequestBody[] = [];
		const server = http.createServer(async (req, res) => {
			if (req.method !== "POST" || req.url !== "/chat/completions") {
				res.writeHead(404).end();
				return;
			}

			let body = "";
			for await (const chunk of req) {
				body += chunk.toString();
			}
			requestBodies.push(JSON.parse(body) as ChatCompletionsRequestBody);

			res.writeHead(200, {
				"content-type": "text/event-stream",
				"cache-control": "no-cache",
				connection: "keep-alive",
			});
			res.write(
				`data: ${JSON.stringify({
					id: "chatcmpl-repro",
					object: "chat.completion.chunk",
					created: 0,
					model: "repro-model",
					choices: [{ index: 0, delta: { role: "assistant", content: "ok" }, finish_reason: null }],
				})}\n\n`,
			);
			res.write(
				`data: ${JSON.stringify({
					id: "chatcmpl-repro",
					object: "chat.completion.chunk",
					created: 0,
					model: "repro-model",
					choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
					usage: { prompt_tokens: 1, completion_tokens: 1 },
				})}\n\n`,
			);
			res.write("data: [DONE]\n\n");
			res.end();
		});

		server.listen(0, "127.0.0.1");
		await once(server, "listening");

		try {
			const { port } = server.address() as AddressInfo;
			const events = await collectEvents(
				streamOpenAICompletions(
					buildModel(`http://127.0.0.1:${port}`),
					buildContext(
						buildAssistant([
							{ type: "thinking", thinking: "internal reasoning" },
							{ type: "text", text: "visible answer" },
						]),
					),
					{ apiKey: "test-key" },
				),
			);

			expect(requestBodies).toHaveLength(1);
			expect(requestBodies[0]?.messages[1]).toEqual({
				role: "assistant",
				content: [
					{ type: "text", text: "internal reasoning" },
					{ type: "text", text: "visible answer" },
				],
			});

			const terminalEvent = events.at(-1);
			expect(terminalEvent?.type).toBe("done");
		} finally {
			server.close();
			await once(server, "close");
		}
	});

	it.each([
		['<response>\n{"name":"read","arguments":{"path":"README.md"}}\n</response>'],
		['<tool_call>\n{"name":"read","arguments":{"path":"README.md"}}\n</tool_call>'],
		['<function_call>\n{"name":"read","arguments":{"path":"README.md"}}\n</function_call>'],
		['<tools>\n{"name":"read","arguments":{"path":"README.md"}}\n</tools>'],
		['{"name":"read","arguments":{"path":"README.md"}}'],
		['```json\n{"name":"read","arguments":{"path":"README.md"}}\n```'],
		[
			'To inspect the package, I will read the README.\n\n```bash\n  {"name":"read","arguments":{"path":"README.md"}}\n```\n\nThis will show the package details.',
		],
	])("converts qwen tool content to a tool call when compat is enabled", async (content) => {
		const server = http.createServer(async (req, res) => {
			if (req.method !== "POST" || req.url !== "/chat/completions") {
				res.writeHead(404).end();
				return;
			}

			for await (const _chunk of req) {
				// Drain the request body.
			}

			res.writeHead(200, {
				"content-type": "text/event-stream",
				"cache-control": "no-cache",
				connection: "keep-alive",
			});
			res.write(
				`data: ${JSON.stringify({
					id: "chatcmpl-qwen",
					object: "chat.completion.chunk",
					created: 0,
					model: "repro-model",
					choices: [
						{
							index: 0,
							delta: {
								role: "assistant",
								content,
							},
							finish_reason: null,
						},
					],
				})}\n\n`,
			);
			res.write(
				`data: ${JSON.stringify({
					id: "chatcmpl-qwen",
					object: "chat.completion.chunk",
					created: 0,
					model: "repro-model",
					choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
					usage: { prompt_tokens: 1, completion_tokens: 1 },
				})}\n\n`,
			);
			res.write("data: [DONE]\n\n");
			res.end();
		});

		server.listen(0, "127.0.0.1");
		await once(server, "listening");

		try {
			const { port } = server.address() as AddressInfo;
			const model = buildModel(`http://127.0.0.1:${port}`);
			model.compat = { ...compat, toolCallContentFormat: "qwen-response" };
			const events = await collectEvents(
				streamOpenAICompletions(
					model,
					{
						messages: [{ role: "user", content: "read the readme", timestamp: 1 }],
						tools: [{ name: "read", description: "Read a file", parameters: { type: "object", properties: {} } }],
					},
					{ apiKey: "test-key" },
				),
			);

			const terminalEvent = events.at(-1);
			expect(terminalEvent?.type).toBe("done");
			if (terminalEvent?.type !== "done") {
				throw new Error("expected done event");
			}
			expect(terminalEvent.reason).toBe("toolUse");
			expect(terminalEvent.message.content).toEqual([
				{
					type: "toolCall",
					id: expect.stringMatching(/^call_/),
					name: "read",
					arguments: { path: "README.md" },
				},
			]);
		} finally {
			server.close();
			await once(server, "close");
		}
	});

	it("converts a qwen shell fence to a bash tool call when bash is available", async () => {
		const server = http.createServer(async (req, res) => {
			if (req.method !== "POST" || req.url !== "/chat/completions") {
				res.writeHead(404).end();
				return;
			}

			for await (const _chunk of req) {
				// Drain the request body.
			}

			res.writeHead(200, {
				"content-type": "text/event-stream",
				"cache-control": "no-cache",
				connection: "keep-alive",
			});
			res.write(
				`data: ${JSON.stringify({
					id: "chatcmpl-qwen",
					object: "chat.completion.chunk",
					created: 0,
					model: "repro-model",
					choices: [
						{
							index: 0,
							delta: {
								role: "assistant",
								content:
									"Let's inspect the directory first.\n\n```bash\nls -la ~/Documents/amoebum\n```\n\nThen I can choose what to read.",
							},
							finish_reason: null,
						},
					],
				})}\n\n`,
			);
			res.write(
				`data: ${JSON.stringify({
					id: "chatcmpl-qwen",
					object: "chat.completion.chunk",
					created: 0,
					model: "repro-model",
					choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
					usage: { prompt_tokens: 1, completion_tokens: 1 },
				})}\n\n`,
			);
			res.write("data: [DONE]\n\n");
			res.end();
		});

		server.listen(0, "127.0.0.1");
		await once(server, "listening");

		try {
			const { port } = server.address() as AddressInfo;
			const model = buildModel(`http://127.0.0.1:${port}`);
			model.compat = { ...compat, toolCallContentFormat: "qwen-response" };
			const events = await collectEvents(
				streamOpenAICompletions(
					model,
					{
						messages: [{ role: "user", content: "inspect amoebum", timestamp: 1 }],
						tools: [
							{
								name: "bash",
								description: "Run a bash command",
								parameters: { type: "object", properties: {} },
							},
						],
					},
					{ apiKey: "test-key" },
				),
			);

			const terminalEvent = events.at(-1);
			expect(terminalEvent?.type).toBe("done");
			if (terminalEvent?.type !== "done") {
				throw new Error("expected done event");
			}
			expect(terminalEvent.reason).toBe("toolUse");
			expect(terminalEvent.message.content).toEqual([
				{
					type: "toolCall",
					id: expect.stringMatching(/^call_/),
					name: "bash",
					arguments: { command: "ls -la ~/Documents/amoebum" },
				},
			]);
		} finally {
			server.close();
			await once(server, "close");
		}
	});
});
