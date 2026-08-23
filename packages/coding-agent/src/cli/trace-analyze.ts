import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

export interface TraceToolCall {
	id?: string;
	name: string;
	input?: JsonRecord;
	line: number;
	source: string;
}

export interface TraceToolResult {
	id?: string;
	name: string;
	isError?: boolean;
	line: number;
	source: string;
}

export interface TraceFileMutation {
	path: string;
	tool: string;
	line: number;
	status: "recorded_result" | "requested_only";
}

export interface TraceCommand {
	command: string;
	line: number;
	status: "recorded_result" | "requested_only" | "bash_execution";
}

export interface TraceRead {
	path: string;
	tool: string;
	line: number;
}

export interface TraceFalseCompletionClaim {
	label: string;
	message: string;
}

export interface TraceAnalysis {
	path?: string;
	session?: {
		id?: string;
		cwd?: string;
		timestamp?: string;
	};
	model?: {
		provider?: string;
		modelId?: string;
	};
	lineCount: number;
	parseErrors: Array<{ line: number; message: string }>;
	messageCounts: Record<string, number>;
	toolCalls: TraceToolCall[];
	toolResults: TraceToolResult[];
	editedFiles: TraceFileMutation[];
	readFiles: TraceRead[];
	commandsRun: TraceCommand[];
	falseCompletionClaims: TraceFalseCompletionClaim[];
	labels: string[];
}

interface ParsedLine {
	line: number;
	entry: JsonRecord;
}

const MUTATING_TOOLS = new Set(["edit", "write"]);
const READ_TOOLS = new Set(["read"]);
const COMMAND_TOOLS = new Set(["bash", "shell"]);

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(record: JsonRecord, key: string): string | undefined {
	const value = record[key];
	return typeof value === "string" ? value : undefined;
}

function getBoolean(record: JsonRecord, key: string): boolean | undefined {
	const value = record[key];
	return typeof value === "boolean" ? value : undefined;
}

function getArray(record: JsonRecord, key: string): unknown[] | undefined {
	const value = record[key];
	return Array.isArray(value) ? value : undefined;
}

function parseJsonRecord(value: string): JsonRecord | undefined {
	try {
		const parsed = JSON.parse(value) as unknown;
		return isRecord(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function getInput(record: JsonRecord): JsonRecord | undefined {
	const input = record.input ?? record.arguments ?? record.args ?? record.params;
	if (isRecord(input)) return input;
	if (typeof input === "string") return parseJsonRecord(input);
	return undefined;
}

function getPath(input: JsonRecord | undefined): string | undefined {
	if (!input) return undefined;
	return (
		getString(input, "path") ??
		getString(input, "filePath") ??
		getString(input, "file_path") ??
		getString(input, "filepath") ??
		getString(input, "filename")
	);
}

function getToolName(record: JsonRecord): string | undefined {
	return getString(record, "toolName") ?? getString(record, "name") ?? getString(record, "tool");
}

function getToolId(record: JsonRecord): string | undefined {
	return getString(record, "toolCallId") ?? getString(record, "id");
}

function getMessage(entry: JsonRecord): JsonRecord | undefined {
	const message = entry.message;
	return isRecord(message) ? message : undefined;
}

function getMessageText(message: JsonRecord): string {
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block) => {
			if (!isRecord(block)) return "";
			return getString(block, "text") ?? "";
		})
		.filter((text) => text.length > 0)
		.join("\n");
}

function addCount(counts: Record<string, number>, key: string): void {
	counts[key] = (counts[key] ?? 0) + 1;
}

function isToolCallLike(record: JsonRecord): boolean {
	const type = getString(record, "type");
	return type === "toolCall" || type === "tool_call" || type === "tool_execution_start";
}

function isToolResultLike(record: JsonRecord): boolean {
	const type = getString(record, "type");
	return type === "toolResult" || type === "tool_result" || type === "tool_execution_end";
}

function collectDirectToolEvent(
	entry: JsonRecord,
	line: number,
	toolCalls: TraceToolCall[],
	toolResults: TraceToolResult[],
): void {
	const type = getString(entry, "type");
	if (!type) return;

	if (isToolCallLike(entry)) {
		const name = getToolName(entry);
		if (!name) return;
		toolCalls.push({
			id: getToolId(entry),
			name,
			input: getInput(entry),
			line,
			source: type,
		});
		return;
	}

	if (isToolResultLike(entry)) {
		const name = getToolName(entry);
		if (!name) return;
		toolResults.push({
			id: getToolId(entry),
			name,
			isError: getBoolean(entry, "isError"),
			line,
			source: type,
		});
	}
}

function collectMessageEvidence(
	message: JsonRecord,
	line: number,
	messageCounts: Record<string, number>,
	toolCalls: TraceToolCall[],
	toolResults: TraceToolResult[],
	assistantTexts: string[],
	bashExecutions: TraceCommand[],
): void {
	const role = getString(message, "role") ?? "unknown";
	addCount(messageCounts, role);

	if (role === "assistant") {
		const text = getMessageText(message);
		if (text) assistantTexts.push(text);

		const content = getArray(message, "content") ?? [];
		for (const block of content) {
			if (!isRecord(block) || !isToolCallLike(block)) continue;
			const name = getToolName(block);
			if (!name) continue;
			toolCalls.push({
				id: getToolId(block),
				name,
				input: getInput(block),
				line,
				source: "assistant_message",
			});
		}
		return;
	}

	if (role === "toolResult") {
		const name = getToolName(message);
		if (!name) return;
		toolResults.push({
			id: getToolId(message),
			name,
			isError: getBoolean(message, "isError"),
			line,
			source: "tool_result_message",
		});
		return;
	}

	if (role === "bashExecution") {
		const command = getString(message, "command");
		if (!command) return;
		bashExecutions.push({
			command,
			line,
			status: "bash_execution",
		});
	}
}

function collectCustomEvidence(
	entry: JsonRecord,
	line: number,
	toolCalls: TraceToolCall[],
	toolResults: TraceToolResult[],
): void {
	const data = entry.data;
	if (!isRecord(data)) return;
	collectDirectToolEvent(data, line, toolCalls, toolResults);
}

function parseJsonl(content: string): { parsedLines: ParsedLine[]; parseErrors: TraceAnalysis["parseErrors"] } {
	const parsedLines: ParsedLine[] = [];
	const parseErrors: TraceAnalysis["parseErrors"] = [];
	const lines = content.split(/\r?\n/);

	for (let index = 0; index < lines.length; index++) {
		const raw = lines[index].trim();
		if (!raw) continue;
		try {
			const parsed = JSON.parse(raw) as unknown;
			if (!isRecord(parsed)) {
				parseErrors.push({ line: index + 1, message: "JSONL entry is not an object" });
				continue;
			}
			parsedLines.push({ line: index + 1, entry: parsed });
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			parseErrors.push({ line: index + 1, message });
		}
	}

	return { parsedLines, parseErrors };
}

function hasCompletedResult(call: TraceToolCall, resultById: Map<string, TraceToolResult>): boolean {
	if (!call.id) return false;
	const result = resultById.get(call.id);
	return result !== undefined && result.isError !== true;
}

function buildFileMutations(toolCalls: TraceToolCall[], resultById: Map<string, TraceToolResult>): TraceFileMutation[] {
	return toolCalls
		.filter((call) => MUTATING_TOOLS.has(call.name))
		.flatMap((call): TraceFileMutation[] => {
			const path = getPath(call.input);
			if (!path) return [];
			return [
				{
					path,
					tool: call.name,
					line: call.line,
					status: hasCompletedResult(call, resultById) ? "recorded_result" : "requested_only",
				},
			];
		});
}

function buildReads(toolCalls: TraceToolCall[]): TraceRead[] {
	return toolCalls
		.filter((call) => READ_TOOLS.has(call.name))
		.flatMap((call): TraceRead[] => {
			const path = getPath(call.input);
			if (!path) return [];
			return [{ path, tool: call.name, line: call.line }];
		});
}

function buildCommands(
	toolCalls: TraceToolCall[],
	resultById: Map<string, TraceToolResult>,
	bashExecutions: TraceCommand[],
): TraceCommand[] {
	const toolCommands = toolCalls
		.filter((call) => COMMAND_TOOLS.has(call.name))
		.flatMap((call): TraceCommand[] => {
			const command = call.input ? getString(call.input, "command") : undefined;
			if (!command) return [];
			return [
				{
					command,
					line: call.line,
					status: hasCompletedResult(call, resultById) ? "recorded_result" : "requested_only",
				},
			];
		});
	return [...toolCommands, ...bashExecutions];
}

function buildLabels(
	toolCalls: TraceToolCall[],
	toolResults: TraceToolResult[],
	editedFiles: TraceFileMutation[],
): string[] {
	const labels = new Set<string>();
	if (toolCalls.length === 0) labels.add("no_tool_call");
	if (toolResults.length === 0) labels.add("no_tool_result");
	if (editedFiles.length === 0) labels.add("no_edit_or_write_tool");
	if (editedFiles.some((file) => file.status === "requested_only")) labels.add("mutation_requested_without_result");
	return Array.from(labels).sort();
}

function detectFalseCompletionClaims(
	assistantTexts: string[],
	toolCalls: TraceToolCall[],
	editedFiles: TraceFileMutation[],
	readFiles: TraceRead[],
	commandsRun: TraceCommand[],
): TraceFalseCompletionClaim[] {
	const text = assistantTexts.join("\n\n");
	const lower = text.toLowerCase();
	const claims: TraceFalseCompletionClaim[] = [];
	const hasCompletedMutation = editedFiles.some((file) => file.status === "recorded_result");
	const hasCommandEvidence = commandsRun.length > 0;
	const hasReadEvidence = readFiles.length > 0;

	if (toolCalls.length === 0 && text.trim().length > 0) {
		claims.push({
			label: "assistant_finished_without_tool_evidence",
			message: "assistant produced a completion, but the trace contains no tool calls",
		});
	}

	if (
		/(^|[^a-z])files_changed([^a-z]|$)|changed files|files changed|edited files|modified files/.test(lower) &&
		!hasCompletedMutation
	) {
		claims.push({
			label: "claimed_files_changed_without_edit_tool",
			message: "assistant claimed file changes, but no successful edit/write tool result was recorded",
		});
	}

	if (
		/(^|[^a-z])tests_run([^a-z]|$)|tests? run|ran tests?|passed|verified|verification/.test(lower) &&
		!hasCommandEvidence
	) {
		claims.push({
			label: "claimed_tests_without_command_evidence",
			message: "assistant claimed test or verification work, but no command execution was recorded",
		});
	}

	if (/file_read_scheduled|scheduled[^.\n]*(read|tool|call)|read[^.\n]*scheduled/.test(lower) && !hasReadEvidence) {
		claims.push({
			label: "claimed_scheduled_read_without_read_tool",
			message: "assistant claimed a scheduled read/tool step, but no read tool call was recorded",
		});
	}

	return claims;
}

export function analyzeTraceContent(content: string, path?: string): TraceAnalysis {
	const { parsedLines, parseErrors } = parseJsonl(content);
	const session: TraceAnalysis["session"] = {};
	const model: TraceAnalysis["model"] = {};
	const messageCounts: Record<string, number> = {};
	const toolCalls: TraceToolCall[] = [];
	const toolResults: TraceToolResult[] = [];
	const assistantTexts: string[] = [];
	const bashExecutions: TraceCommand[] = [];

	for (const { line, entry } of parsedLines) {
		const type = getString(entry, "type");
		if (type === "session") {
			session.id = getString(entry, "id");
			session.cwd = getString(entry, "cwd");
			session.timestamp = getString(entry, "timestamp");
		} else if (type === "model_change") {
			model.provider = getString(entry, "provider");
			model.modelId = getString(entry, "modelId");
		}

		collectDirectToolEvent(entry, line, toolCalls, toolResults);
		if (type === "custom") collectCustomEvidence(entry, line, toolCalls, toolResults);

		const message = getMessage(entry);
		if (message) {
			collectMessageEvidence(message, line, messageCounts, toolCalls, toolResults, assistantTexts, bashExecutions);
		}
	}

	const resultById = new Map(toolResults.flatMap((result) => (result.id ? [[result.id, result] as const] : [])));
	const editedFiles = buildFileMutations(toolCalls, resultById);
	const readFiles = buildReads(toolCalls);
	const commandsRun = buildCommands(toolCalls, resultById, bashExecutions);
	const labels = buildLabels(toolCalls, toolResults, editedFiles);
	const falseCompletionClaims = detectFalseCompletionClaims(
		assistantTexts,
		toolCalls,
		editedFiles,
		readFiles,
		commandsRun,
	);

	return {
		path,
		session: Object.values(session).some((value) => value !== undefined) ? session : undefined,
		model: Object.values(model).some((value) => value !== undefined) ? model : undefined,
		lineCount: content.split(/\r?\n/).filter((line) => line.trim().length > 0).length,
		parseErrors,
		messageCounts,
		toolCalls,
		toolResults,
		editedFiles,
		readFiles,
		commandsRun,
		falseCompletionClaims,
		labels,
	};
}

export function analyzeTraceFile(path: string): TraceAnalysis {
	const resolvedPath = resolve(path);
	return analyzeTraceContent(readFileSync(resolvedPath, "utf8"), resolvedPath);
}

function plural(count: number, singular: string, pluralText = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : pluralText}`;
}

function listOrNone(values: string[]): string[] {
	return values.length > 0 ? values : ["none"];
}

export function formatTraceAnalysis(analysis: TraceAnalysis): string {
	const lines: string[] = [];
	lines.push(`Trace: ${analysis.path ?? "(in-memory)"}`);
	if (analysis.session) {
		const parts = [
			analysis.session.id ? `id=${analysis.session.id}` : undefined,
			analysis.session.cwd ? `cwd=${analysis.session.cwd}` : undefined,
			analysis.session.timestamp ? `timestamp=${analysis.session.timestamp}` : undefined,
		].filter((part): part is string => part !== undefined);
		lines.push(`Session: ${parts.join(" ") || "unknown"}`);
	}
	if (analysis.model) {
		const provider = analysis.model.provider ?? "unknown-provider";
		const model = analysis.model.modelId ?? "unknown-model";
		lines.push(`Model: ${provider}/${model}`);
	}
	lines.push(
		`Messages: ${
			Object.entries(analysis.messageCounts)
				.map(([role, count]) => `${role}=${count}`)
				.join(" ") || "none"
		}`,
	);
	lines.push(`Tool calls: ${plural(analysis.toolCalls.length, "call")}`);
	lines.push(`Tool results: ${plural(analysis.toolResults.length, "result")}`);
	lines.push(`Parse errors: ${plural(analysis.parseErrors.length, "error")}`);

	lines.push("");
	lines.push("Edited files:");
	lines.push(
		...listOrNone(
			analysis.editedFiles.map((file) => `- ${file.path} (${file.tool}, ${file.status}, line ${file.line})`),
		),
	);

	lines.push("");
	lines.push("Commands run:");
	lines.push(
		...listOrNone(
			analysis.commandsRun.map((command) => `- ${command.command} (${command.status}, line ${command.line})`),
		),
	);

	lines.push("");
	lines.push("Read files:");
	lines.push(...listOrNone(analysis.readFiles.map((file) => `- ${file.path} (${file.tool}, line ${file.line})`)));

	lines.push("");
	lines.push("Labels:");
	lines.push(...listOrNone(analysis.labels.map((label) => `- ${label}`)));

	lines.push("");
	lines.push("False completion claims:");
	lines.push(...listOrNone(analysis.falseCompletionClaims.map((claim) => `- ${claim.label}: ${claim.message}`)));

	if (analysis.parseErrors.length > 0) {
		lines.push("");
		lines.push("Parse details:");
		lines.push(...analysis.parseErrors.map((error) => `- line ${error.line}: ${error.message}`));
	}

	return lines.join("\n");
}

function printTraceHelp(): void {
	console.log(`Usage:
  pi trace analyze <session.jsonl> [--json]

Analyze a Pi JSONL session trace and report real tool calls, edited files,
commands run, and completion claims that are not backed by trace evidence.`);
}

export async function handleTraceCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "trace") return false;

	const command = args[1];
	if (command === undefined || command === "--help" || command === "-h") {
		printTraceHelp();
		return true;
	}

	if (command !== "analyze") {
		console.error(`Unknown trace command: ${command}`);
		printTraceHelp();
		process.exitCode = 1;
		return true;
	}

	const json = args.includes("--json");
	const positional = args.slice(2).filter((arg) => arg !== "--json");
	if (positional.includes("--help") || positional.includes("-h")) {
		printTraceHelp();
		return true;
	}

	const tracePath = positional[0];
	if (!tracePath) {
		console.error("Error: trace analyze requires a session JSONL path");
		printTraceHelp();
		process.exitCode = 1;
		return true;
	}

	try {
		const analysis = analyzeTraceFile(tracePath);
		if (json) {
			console.log(JSON.stringify(analysis, null, 2));
		} else {
			console.log(formatTraceAnalysis(analysis));
		}
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`Error: ${message}`);
		process.exitCode = 1;
	}

	return true;
}
