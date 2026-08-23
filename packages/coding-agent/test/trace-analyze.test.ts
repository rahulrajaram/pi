import { describe, expect, it } from "vitest";
import { analyzeTraceContent, formatTraceAnalysis } from "../src/cli/trace-analyze.ts";

function jsonl(...entries: unknown[]): string {
	return entries.map((entry) => JSON.stringify(entry)).join("\n");
}

describe("trace analyzer", () => {
	it("flags completion packets that are not backed by tool evidence", () => {
		const trace = jsonl(
			{
				type: "session",
				id: "pilot-001",
				cwd: "/tmp/amoebum",
				timestamp: "2026-06-18T12:00:00.000Z",
			},
			{
				type: "message",
				message: {
					role: "user",
					content: "Add the guard test.",
					timestamp: 1,
				},
			},
			{
				type: "message",
				message: {
					role: "assistant",
					content: [
						{
							type: "text",
							text: JSON.stringify({
								status: "done",
								files_changed: ["amoebum/test/approval-dialog-guard-test.lisp"],
								tests_run: ["make test"],
								file_read_scheduled: "amoebum/test/approval-dialog-guard-test.lisp",
							}),
						},
					],
					api: "openai-chat-completions",
					provider: "llama-local",
					model: "qwen",
					usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: {} },
					stopReason: "stop",
					timestamp: 2,
				},
			},
		);

		const analysis = analyzeTraceContent(trace, "pilot.jsonl");

		expect(analysis.toolCalls).toHaveLength(0);
		expect(analysis.editedFiles).toHaveLength(0);
		expect(analysis.commandsRun).toHaveLength(0);
		expect(analysis.labels).toContain("no_tool_call");
		expect(analysis.falseCompletionClaims.map((claim) => claim.label)).toEqual([
			"assistant_finished_without_tool_evidence",
			"claimed_files_changed_without_edit_tool",
			"claimed_tests_without_command_evidence",
			"claimed_scheduled_read_without_read_tool",
		]);
	});

	it("reports real tool calls, edited files, commands, and reads", () => {
		const trace = jsonl(
			{
				type: "session",
				id: "trace-001",
				cwd: "/tmp/project",
			},
			{
				type: "model_change",
				provider: "llama-local",
				modelId: "qwen2.5-coder-7b-q6",
			},
			{
				type: "message",
				message: {
					role: "assistant",
					content: [
						{ type: "toolCall", id: "read-1", name: "read", arguments: { path: "src/example.ts" } },
						{
							type: "toolCall",
							id: "edit-1",
							name: "edit",
							arguments: { path: "src/example.ts", edits: [{ oldText: "old", newText: "new" }] },
						},
						{ type: "toolCall", id: "bash-1", name: "bash", arguments: { command: "npm test" } },
					],
					api: "openai-chat-completions",
					provider: "llama-local",
					model: "qwen",
					usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: {} },
					stopReason: "toolUse",
					timestamp: 1,
				},
			},
			{
				type: "message",
				message: {
					role: "toolResult",
					toolCallId: "read-1",
					toolName: "read",
					content: [{ type: "text", text: "old" }],
					isError: false,
					timestamp: 2,
				},
			},
			{
				type: "message",
				message: {
					role: "toolResult",
					toolCallId: "edit-1",
					toolName: "edit",
					content: [{ type: "text", text: "edited" }],
					isError: false,
					timestamp: 3,
				},
			},
			{
				type: "message",
				message: {
					role: "toolResult",
					toolCallId: "bash-1",
					toolName: "bash",
					content: [{ type: "text", text: "passed" }],
					isError: false,
					timestamp: 4,
				},
			},
			{
				type: "message",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "Changed files and verified with tests." }],
					api: "openai-chat-completions",
					provider: "llama-local",
					model: "qwen",
					usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: {} },
					stopReason: "stop",
					timestamp: 5,
				},
			},
		);

		const analysis = analyzeTraceContent(trace, "trace.jsonl");

		expect(analysis.session?.id).toBe("trace-001");
		expect(analysis.model).toEqual({ provider: "llama-local", modelId: "qwen2.5-coder-7b-q6" });
		expect(analysis.toolCalls.map((call) => call.name)).toEqual(["read", "edit", "bash"]);
		expect(analysis.toolResults.map((result) => result.name)).toEqual(["read", "edit", "bash"]);
		expect(analysis.editedFiles).toEqual([
			{ path: "src/example.ts", tool: "edit", line: 3, status: "recorded_result" },
		]);
		expect(analysis.readFiles).toEqual([{ path: "src/example.ts", tool: "read", line: 3 }]);
		expect(analysis.commandsRun).toEqual([{ command: "npm test", line: 3, status: "recorded_result" }]);
		expect(analysis.falseCompletionClaims).toHaveLength(0);
		expect(formatTraceAnalysis(analysis)).toContain("Tool calls: 3 calls");
	});
});
