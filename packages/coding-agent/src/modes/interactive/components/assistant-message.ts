import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
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
import { isFlatScreenReaderMode, trimScreenReaderBlock } from "../accessibility.ts";
import { getMarkdownTheme, theme } from "../theme/theme.ts";
import { createMarkdownTransform } from "./markdown-transform.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

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
	private thinkingVisibilityOverrides = new Map<number, boolean>();

	constructor(
		message?: AssistantMessage,
		hideThinkingBlock = false,
		markdownTheme: MarkdownTheme = getMarkdownTheme(),
		hiddenThinkingLabel = "Thinking...",
		outputPad = 1,
		markdownTransformers: readonly MarkdownTransformer[] = [],
	) {
		super();

		this.hideThinkingBlock = hideThinkingBlock;
		this.markdownTheme = markdownTheme;
		this.hiddenThinkingLabel = hiddenThinkingLabel;
		this.outputPad = outputPad;
		this.markdownTransformers = markdownTransformers;

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
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	override render(width: number): string[] {
		let lines = super.render(width);
		if (isFlatScreenReaderMode()) {
			// trimScreenReaderBlock only blanks whitespace-only lines and strips leading/trailing
			// blank lines; it doesn't trimEnd() non-blank lines. The label-matching below needs
			// exact "Assistant:"/"Thinking:" lines, so trim trailing padding on every line too.
			lines = trimScreenReaderBlock(lines).map((line) => (line.trim() === "" ? "" : line.trimEnd()));
			if (lines.length > 0 && lines[0] !== "Assistant:" && lines[0] !== "Thinking:") {
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

		const hasVisibleContent = message.content.some(
			(c) => (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()),
		);

		const flatScreenReaderMode = isFlatScreenReaderMode();
		const horizontalPadding = flatScreenReaderMode ? 0 : this.outputPad;

		if (hasVisibleContent && !flatScreenReaderMode) {
			this.contentContainer.addChild(new Spacer(1));
		}

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
					this.contentContainer.addChild(new Text("Assistant:", 0, 0));
					assistantLabelAdded = true;
				}
				// Assistant text messages with no background - trim the text
				// Set paddingY=0 to avoid extra spacing before tool executions
				this.contentContainer.addChild(
					new Markdown(content.text.trim(), horizontalPadding, 0, this.markdownTheme, undefined, {
						transform: createMarkdownTransform("assistant", this.isStreaming, this.markdownTransformers),
					}),
				);
			} else if (content.type === "thinking") {
				const thinkingBlocks: string[] = [];
				for (; i < message.content.length; i++) {
					const thinkingContent = message.content[i];
					if (thinkingContent.type !== "thinking") {
						break;
					}
					const thinking = thinkingContent.thinking.trim();
					if (thinking) {
						thinkingBlocks.push(thinking);
					}
				}
				i--;

				if (thinkingBlocks.length === 0) {
					continue;
				}

				// Add spacing only when another visible assistant content block follows.
				// This avoids a superfluous blank line before separately-rendered tool execution blocks.
				const hasVisibleContentAfter = message.content
					.slice(i + 1)
					.some((c) => (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()));

				const runIndex = thinkingRunIndex++;
				const hidden = this.thinkingVisibilityOverrides.get(runIndex) ?? this.hideThinkingBlock;
				if (flatScreenReaderMode) {
					this.contentContainer.addChild(new Text("Thinking:", 0, 0));
				}
				const thinkingComponent = hidden
					? new Text(theme.italic(theme.fg("thinkingText", this.hiddenThinkingLabel)), horizontalPadding, 0)
					: new Markdown(
							thinkingBlocks.join("\n\n"),
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
									this.isStreaming,
									this.markdownTransformers,
								),
							},
						);
				this.contentContainer.addChild(
					new MouseRegion(thinkingComponent, (event) => {
						if (event.type !== "click" || event.button !== "left") return undefined;
						this.thinkingVisibilityOverrides.set(runIndex, !hidden);
						if (this.lastMessage) this.updateContent(this.lastMessage);
						return { handled: true };
					}),
				);
				if (hasVisibleContentAfter) {
					this.contentContainer.addChild(new Spacer(1));
				}
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
