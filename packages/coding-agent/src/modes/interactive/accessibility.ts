import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { stripAnsi } from "../../utils/ansi.ts";

export type ScreenReaderMode = "flat";

let screenReaderMode: ScreenReaderMode | undefined;

export function setScreenReaderMode(mode: ScreenReaderMode | undefined): void {
	screenReaderMode = mode;
}

export function getScreenReaderMode(): ScreenReaderMode | undefined {
	return screenReaderMode;
}

export function isFlatScreenReaderMode(): boolean {
	return screenReaderMode === "flat";
}

export function getSelectionPrefix(nonFlatDefault = "→ "): string {
	return isFlatScreenReaderMode() ? "> " : nonFlatDefault;
}

/**
 * Blanks out whitespace-only lines and drops leading/trailing blank lines, so a
 * screen reader doesn't announce empty space at the start or end of a block.
 */
export function trimScreenReaderBlock(lines: string[]): string[] {
	if (!isFlatScreenReaderMode()) {
		return lines;
	}

	const result = lines.map((line) => (stripAnsi(line).trim() === "" ? "" : line));
	while (result.length > 0 && result[0] === "") {
		result.shift();
	}
	while (result.length > 0 && result[result.length - 1] === "") {
		result.pop();
	}
	return result;
}

export function mergeScreenReaderLabelWithBody(lines: string[], width?: number): string[] {
	if (!isFlatScreenReaderMode()) {
		return lines;
	}

	const trimmed = trimScreenReaderBlock(lines);
	const labelIndex = trimmed.findIndex((line) => stripAnsi(line).trim().endsWith(":"));
	if (labelIndex === -1) {
		return trimmed;
	}

	const bodyIndex = trimmed.findIndex((line, index) => index > labelIndex && stripAnsi(line).trim() !== "");
	if (bodyIndex === -1) {
		return trimmed;
	}

	const mergedLine = `${stripAnsi(trimmed[labelIndex]!).trimEnd()} ${stripAnsi(trimmed[bodyIndex]!).trim()}`;
	const line =
		width !== undefined && visibleWidth(mergedLine) > width ? truncateToWidth(mergedLine, width, "") : mergedLine;
	return [...trimmed.slice(0, labelIndex), line, ...trimmed.slice(bodyIndex + 1)];
}

/**
 * Merges every exact-match label line (e.g. "Tool:", "Result:") with the first
 * non-blank line that follows it, so screen readers speak the label and its
 * content as one line instead of two. Unlike mergeScreenReaderLabelWithBody,
 * this matches an explicit label set rather than any line ending in ":", and
 * merges every occurrence rather than only the first. Blank lines between a
 * label and its body (or between two adjacent labels) are dropped rather than
 * left dangling.
 */
export function mergeScreenReaderLabels(lines: string[], labels: string[], width?: number): string[] {
	if (!isFlatScreenReaderMode()) {
		return lines;
	}

	const result = trimScreenReaderBlock(lines);
	for (let i = 0; i < result.length; i++) {
		const label = stripAnsi(result[i]!).trim();
		if (!labels.includes(label)) {
			continue;
		}
		let bodyIndex = i + 1;
		while (bodyIndex < result.length && stripAnsi(result[bodyIndex]!).trim() === "") {
			bodyIndex++;
		}
		if (bodyIndex >= result.length) {
			continue;
		}
		const bodyLine = stripAnsi(result[bodyIndex]!).trim();
		if (labels.includes(bodyLine)) {
			// Drop the blank run between two adjacent labels without merging them.
			result.splice(i + 1, bodyIndex - (i + 1));
			continue;
		}
		const mergedLine = `${label} ${bodyLine}`;
		const line =
			width !== undefined && visibleWidth(mergedLine) > width ? truncateToWidth(mergedLine, width, "") : mergedLine;
		result.splice(i, bodyIndex - i + 1, line);
	}
	return trimScreenReaderBlock(result);
}
