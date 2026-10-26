import type { Component } from "../tui.ts";
import {
	applyBackgroundToLine,
	expandTabs,
	flattenLines,
	getComponentWrapping,
	splitTextWithAnsi,
	visibleWidth,
	wrapTextWithAnsi,
} from "../utils.ts";

/**
 * Text component - displays multi-line text with word wrapping
 */
export class Text implements Component {
	private text: string;
	private paddingX: number; // Left/right padding
	private paddingY: number; // Top/bottom padding
	private customBgFn?: (text: string) => string;

	// Cache for rendered output
	private cachedText?: string;
	private cachedWidth?: number;
	private cachedWrap?: boolean;
	private cachedLines?: string[];

	constructor(text: string = "", paddingX: number = 1, paddingY: number = 1, customBgFn?: (text: string) => string) {
		this.text = text;
		this.paddingX = paddingX;
		this.paddingY = paddingY;
		this.customBgFn = customBgFn;
	}

	setText(text: string): void {
		this.text = text;
		this.cachedText = undefined;
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	setCustomBgFn(customBgFn?: (text: string) => string): void {
		this.customBgFn = customBgFn;
		this.cachedText = undefined;
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	setPaddingX(paddingX: number): void {
		this.paddingX = paddingX;
		this.invalidate();
	}

	invalidate(): void {
		this.cachedText = undefined;
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	render(width: number): string[] {
		const wrap = getComponentWrapping();
		// Check cache
		if (this.cachedLines && this.cachedText === this.text && this.cachedWidth === width && this.cachedWrap === wrap) {
			return this.cachedLines;
		}

		// Don't render anything if there's no actual text
		if (!this.text || this.text.trim() === "") {
			const result: string[] = [];
			this.cachedText = this.text;
			this.cachedWidth = width;
			this.cachedWrap = wrap;
			this.cachedLines = result;
			return result;
		}

		const normalizedText = expandTabs(this.text);

		// Reduce margins when necessary so content and padding fit within the available width.
		// Without component wrapping, text is shown as written, without margins.
		const paddingX = wrap ? Math.min(this.paddingX, Math.max(0, Math.floor((width - 1) / 2))) : 0;
		const contentWidth = Math.max(1, width - paddingX * 2);

		// Wrap text (this preserves ANSI codes but does NOT pad)
		const wrappedLines = wrap ? wrapTextWithAnsi(normalizedText, contentWidth) : splitTextWithAnsi(normalizedText);

		// Add margins and background to each line
		const leftMargin = " ".repeat(paddingX);
		const rightMargin = " ".repeat(paddingX);
		const contentLines: string[] = [];

		for (const line of wrappedLines) {
			// Add margins
			const lineWithMargins = leftMargin + line + rightMargin;

			// Apply background if specified (this also pads to full width)
			if (this.customBgFn) {
				contentLines.push(applyBackgroundToLine(lineWithMargins, width, this.customBgFn));
			} else {
				// No background - just pad to width with spaces
				const visibleLen = visibleWidth(lineWithMargins);
				const paddingNeeded = Math.max(0, width - visibleLen);
				contentLines.push(lineWithMargins + " ".repeat(paddingNeeded));
			}
		}

		// Add top/bottom padding (empty lines)
		const emptyLine = " ".repeat(width);
		const emptyLines: string[] = [];
		for (let i = 0; i < this.paddingY; i++) {
			const line = this.customBgFn ? applyBackgroundToLine(emptyLine, width, this.customBgFn) : emptyLine;
			emptyLines.push(line);
		}

		const result = [...emptyLines, ...contentLines, ...emptyLines];
		flattenLines(result);

		// Update cache
		this.cachedText = this.text;
		this.cachedWidth = width;
		this.cachedWrap = wrap;
		this.cachedLines = result;

		return result.length > 0 ? result : [""];
	}
}
