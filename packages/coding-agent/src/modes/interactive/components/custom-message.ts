import type { TextContent } from "@earendil-works/pi-ai";
import type { Component } from "@earendil-works/pi-tui";
import { Box, Container, Markdown, type MarkdownTheme, Spacer, Text } from "@earendil-works/pi-tui";
import type { MessageRenderer } from "../../../core/extensions/types.ts";
import type { CustomMessage } from "../../../core/messages.ts";
import { isFlatScreenReaderMode, mergeScreenReaderLabelWithBody } from "../accessibility.ts";
import { getMarkdownTheme, theme } from "../theme/theme.ts";

/**
 * Component that renders a custom message entry from extensions.
 * Uses distinct styling to differentiate from user messages.
 */
export class CustomMessageComponent extends Container {
	private message: CustomMessage<unknown>;
	private customRenderer?: MessageRenderer;
	private box: Box;
	private customComponent?: Component;
	private markdownTheme: MarkdownTheme;
	private _expanded = false;

	constructor(
		message: CustomMessage<unknown>,
		customRenderer?: MessageRenderer,
		markdownTheme: MarkdownTheme = getMarkdownTheme(),
	) {
		super();
		this.message = message;
		this.customRenderer = customRenderer;
		this.markdownTheme = markdownTheme;

		this.addChild(new Spacer(1));

		// Create box with purple background (used for default rendering)
		const padding = isFlatScreenReaderMode() ? 0 : 1;
		this.box = new Box(padding, padding, (t) => theme.bg("customMessageBg", t));

		this.rebuild();
	}

	setExpanded(expanded: boolean): void {
		if (this._expanded !== expanded) {
			this._expanded = expanded;
			this.rebuild();
		}
	}

	override invalidate(): void {
		super.invalidate();
		this.rebuild();
	}

	override render(width: number): string[] {
		return mergeScreenReaderLabelWithBody(super.render(width), width);
	}

	private rebuild(): void {
		// Remove previous content component
		if (this.customComponent) {
			this.removeChild(this.customComponent);
			this.customComponent = undefined;
		}
		this.removeChild(this.box);

		// Try custom renderer first - it handles its own styling
		if (this.customRenderer) {
			try {
				const component = this.customRenderer(this.message, { expanded: this._expanded }, theme);
				if (component) {
					// Custom renderer provides its own styled component
					this.customComponent = component;
					this.addChild(component);
					return;
				}
			} catch {
				// Fall through to default rendering
			}
		}

		// Default rendering uses our box
		this.addChild(this.box);
		this.box.clear();

		// Default rendering: label + content
		const labelText = isFlatScreenReaderMode()
			? `Extension: ${this.message.customType}`
			: `[${this.message.customType}]`;
		const label = theme.fg("customMessageLabel", `\x1b[1m${labelText}\x1b[22m`);
		this.box.addChild(new Text(label, 0, 0));
		this.box.addChild(new Spacer(1));

		// Extract text content
		let text: string;
		if (typeof this.message.content === "string") {
			text = this.message.content;
		} else {
			text = this.message.content
				.filter((c): c is TextContent => c.type === "text")
				.map((c) => c.text)
				.join("\n");
		}

		this.box.addChild(
			new Markdown(text, 0, 0, this.markdownTheme, {
				color: (text: string) => theme.fg("customMessageText", text),
			}),
		);
	}
}
