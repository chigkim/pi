import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
	type Component,
	Container,
	Markdown,
	type MarkdownTheme,
	MouseRegion,
	Spacer,
	Text,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { MarkdownTransformer } from "../../../core/extensions/types.ts";
import {
	isFlatScreenReaderMode,
	isScreenReaderTerminalWrap,
	trimOutputText,
	trimScreenReaderBlock,
} from "../accessibility.ts";
import { getMarkdownTheme, theme } from "../theme/theme.ts";
import { createMarkdownTransform } from "./markdown-transform.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

/**
 * A Markdown block of the last update. The next update reuses it at the same position for the same kind of content, so
 * a streamed answer keeps the blocks it already rendered, also once the stream ends.
 */
interface MarkdownSlot {
	kind: "text" | "thinking";
	markdown: Markdown;
}

/**
 * Component that renders a complete assistant message
 */
export class AssistantMessageComponent extends Container {
	private contentContainer: Container;
	private hideThinkingBlock: boolean;
	private markdownTheme: MarkdownTheme;
	private hiddenThinkingLabel: string;
	private outputPad: number;
	private markdownTransformers: readonly MarkdownTransformer[];
	private lastMessage?: AssistantMessage;
	private hasToolCalls = false;
	private isStreaming = false;
	private messageId?: string;
	private timestamp?: string;
	private thinkingVisibilityOverrides = new Map<number, boolean>();
	private markdownSlots: MarkdownSlot[] = [];

	constructor(
		message?: AssistantMessage,
		hideThinkingBlock = false,
		markdownTheme: MarkdownTheme = getMarkdownTheme(),
		hiddenThinkingLabel = "Thinking...",
		outputPad = 1,
		markdownTransformers: readonly MarkdownTransformer[] = [],
		messageId?: string,
		timestamp?: string,
	) {
		super();

		this.hideThinkingBlock = hideThinkingBlock;
		this.markdownTheme = markdownTheme;
		this.hiddenThinkingLabel = hiddenThinkingLabel;
		this.outputPad = outputPad;
		this.markdownTransformers = markdownTransformers;
		this.messageId = messageId;
		this.timestamp = timestamp;

		// Container for text/thinking content
		this.contentContainer = new Container();
		this.addChild(this.contentContainer);

		if (message) {
			this.updateContent(message);
		}
	}

	override invalidate(): void {
		super.invalidate();
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setHideThinkingBlock(hide: boolean): void {
		this.hideThinkingBlock = hide;
		this.thinkingVisibilityOverrides.clear();
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setHiddenThinkingLabel(label: string): void {
		this.hiddenThinkingLabel = label;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setOutputPad(padding: number): void {
		this.outputPad = padding;
		// Markdown takes its padding at construction.
		this.markdownSlots = [];
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	override render(width: number): string[] {
		let lines = super.render(width);
		if (isFlatScreenReaderMode()) {
			const terminalWrap = isScreenReaderTerminalWrap();
			// trimScreenReaderBlock only blanks whitespace-only lines and strips leading/trailing
			// blank lines; it doesn't trimEnd() non-blank lines. The label-matching below needs
			// exact "Assistant:"/"Thinking:" lines, so trim trailing padding on every line too.
			lines = trimScreenReaderBlock(lines).map((line) => (line.trim() === "" ? "" : line.trimEnd()));
			if (lines.length > 0 && lines[0] !== "Assistant:" && lines[0] !== "Thinking:" && !terminalWrap) {
				lines[0] = lines[0].trimStart();
			}
			for (let i = 0; i < lines.length; i++) {
				const label = lines[i];
				if (label !== "Assistant:" && label !== "Thinking:") {
					continue;
				}
				let bodyIndex = i + 1;
				while (bodyIndex < lines.length && lines[bodyIndex].trim() === "") {
					bodyIndex++;
				}
				if (bodyIndex >= lines.length) {
					continue;
				}
				const bodyLine = lines[bodyIndex];
				if (bodyLine === "Assistant:" || bodyLine === "Thinking:") {
					// Drop the blank run between two adjacent labels without merging them.
					lines.splice(i + 1, bodyIndex - (i + 1));
					continue;
				}
				const labelPrefix = `${label} `;
				if (terminalWrap) {
					// The terminal wraps the merged line, so the body keeps its indentation and is not re-wrapped.
					lines.splice(i, bodyIndex - i + 1, labelPrefix + bodyLine);
					continue;
				}
				const firstLineWidth = Math.max(1, width - visibleWidth(labelPrefix));
				const firstLineParts = wrapTextWithAnsi(bodyLine.trimStart(), firstLineWidth);
				lines.splice(i, bodyIndex - i + 1, labelPrefix + firstLineParts[0], ...firstLineParts.slice(1));
			}
		}
		if (this.hasToolCalls || lines.length === 0) {
			return lines;
		}

		lines[0] = OSC133_ZONE_START + lines[0];
		lines[lines.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + lines[lines.length - 1];
		return lines;
	}

	updateContent(message: AssistantMessage, isStreaming = this.isStreaming): void {
		this.lastMessage = message;
		this.isStreaming = isStreaming;

		// Clear content container
		this.contentContainer.clear();
		const previousSlots = this.markdownSlots;
		this.markdownSlots = [];
		const markdownBlock = (kind: MarkdownSlot["kind"], text: string, create: () => Markdown): Markdown => {
			const slot = previousSlots[this.markdownSlots.length];
			const markdown = slot?.kind === kind ? slot.markdown : create();
			markdown.setText(text);
			this.markdownSlots.push({ kind, markdown });
			return markdown;
		};

		const flatScreenReaderMode = isFlatScreenReaderMode();
		// With terminal wrapping, model text is shown as written: no Markdown rendering, wrapping, or indentation.
		const terminalWrap = isScreenReaderTerminalWrap();
		const horizontalPadding = flatScreenReaderMode ? 0 : this.outputPad;

		// Spacers are added lazily, right before the next visible content block. This puts a blank
		// line before the first visible block and after each visible thinking run that is followed
		// by more visible content, while hidden thinking runs without a label contribute nothing.
		// Flat screen reader mode skips the leading blank line.
		let needsSpacer = !flatScreenReaderMode;
		const addVisibleChild = (child: Component) => {
			if (needsSpacer) {
				this.contentContainer.addChild(new Spacer(1));
				needsSpacer = false;
			}
			this.contentContainer.addChild(child);
		};

		// In flat screen reader mode, "Assistant:" labels the final response text. When the
		// message opens with thinking, the "Thinking:" label already announces the assistant
		// is speaking, so an "Assistant:" line right before it would just be a redundant echo.
		let assistantLabelAdded = false;

		// Render content in order
		let thinkingRunIndex = 0;
		for (let i = 0; i < message.content.length; i++) {
			const content = message.content[i];
			if (content.type === "text" && content.text.trim()) {
				if (flatScreenReaderMode && !assistantLabelAdded) {
					addVisibleChild(new Text("Assistant:", 0, 0));
					assistantLabelAdded = true;
				}
				// Assistant text messages with no background - trim the text
				// Set paddingY=0 to avoid extra spacing before tool executions
				const text = content.text.trim();
				addVisibleChild(
					terminalWrap
						? new Text(trimOutputText(content.text), 0, 0)
						: markdownBlock(
								"text",
								text,
								() =>
									new Markdown(text, horizontalPadding, 0, this.markdownTheme, undefined, {
										transform: createMarkdownTransform(
											"assistant",
											() => this.isStreaming,
											this.markdownTransformers,
											this.messageId,
											this.timestamp,
										),
									}),
							),
				);
			} else if (content.type === "thinking") {
				const thinkingBlocks: string[] = [];
				for (; i < message.content.length; i++) {
					const thinkingContent = message.content[i];
					if (thinkingContent.type !== "thinking") {
						break;
					}
					const thinking = terminalWrap
						? trimOutputText(thinkingContent.thinking)
						: thinkingContent.thinking.trim();
					if (thinking) {
						thinkingBlocks.push(thinking);
					}
				}
				i--;

				if (thinkingBlocks.length === 0) {
					continue;
				}

				const runIndex = thinkingRunIndex++;
				const hidden = this.thinkingVisibilityOverrides.get(runIndex) ?? this.hideThinkingBlock;
				// A hidden run with an empty label renders nothing, including no spacing.
				if (hidden && !this.hiddenThinkingLabel.trim()) {
					continue;
				}
				if (flatScreenReaderMode) {
					addVisibleChild(new Text("Thinking:", 0, 0));
				}
				const thinking = thinkingBlocks.join("\n\n");
				const thinkingComponent = hidden
					? new Text(theme.italic(theme.fg("thinkingText", this.hiddenThinkingLabel)), horizontalPadding, 0)
					: terminalWrap
						? new Text(theme.italic(theme.fg("thinkingText", thinking)), 0, 0)
						: markdownBlock(
								"thinking",
								thinking,
								() =>
									new Markdown(
										thinking,
										horizontalPadding,
										0,
										this.markdownTheme,
										{
											color: (text: string) => theme.fg("thinkingText", text),
											italic: true,
										},
										{
											transform: createMarkdownTransform(
												"assistant-thinking",
												() => this.isStreaming,
												this.markdownTransformers,
												this.messageId,
												this.timestamp,
											),
										},
									),
							);
				addVisibleChild(
					new MouseRegion(thinkingComponent, (event) => {
						if (event.type !== "click" || event.button !== "left") return undefined;
						this.thinkingVisibilityOverrides.set(runIndex, !hidden);
						if (this.lastMessage) this.updateContent(this.lastMessage);
						return { handled: true };
					}),
				);
				// Add spacing only when another visible assistant content block follows.
				// This avoids a superfluous blank line before separately-rendered tool execution blocks.
				needsSpacer = true;
			}
		}

		// Check if incomplete/failed - show after partial content.
		// For aborted/error tool calls, tool execution components show the error.
		// Length stops can happen before a tool call is complete, so surface them here too.
		const hasToolCalls = message.content.some((c) => c.type === "toolCall");
		this.hasToolCalls = hasToolCalls;
		if (message.stopReason === "length") {
			this.contentContainer.addChild(new Spacer(1));
			this.contentContainer.addChild(
				new Text(theme.fg("error", "Response was truncated before completion."), horizontalPadding, 0),
			);
		} else if (!hasToolCalls) {
			if (message.stopReason === "aborted") {
				const abortMessage =
					message.errorMessage && message.errorMessage !== "Request was aborted"
						? message.errorMessage
						: "Operation aborted";
				this.contentContainer.addChild(new Spacer(1));
				this.contentContainer.addChild(new Text(theme.fg("error", abortMessage), horizontalPadding, 0));
			} else if (message.stopReason === "error") {
				const errorMsg = message.errorMessage || "Unknown error";
				this.contentContainer.addChild(new Spacer(1));
				this.contentContainer.addChild(new Text(theme.fg("error", `Error: ${errorMsg}`), horizontalPadding, 0));
			}
		}
	}
}
