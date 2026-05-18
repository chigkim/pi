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

export function getSelectionPrefix(): string {
	return isFlatScreenReaderMode() ? "> " : "→ ";
}

export function mergeScreenReaderLabelWithBody(lines: string[], width?: number): string[] {
	if (!isFlatScreenReaderMode()) {
		return lines;
	}

	const labelIndex = lines.findIndex((line) => stripAnsi(line).trim().endsWith(":"));
	if (labelIndex === -1) {
		return lines;
	}

	const bodyIndex = lines.findIndex((line, index) => index > labelIndex && stripAnsi(line).trim() !== "");
	if (bodyIndex === -1) {
		return lines;
	}

	const mergedLine = `${stripAnsi(lines[labelIndex]!).trimEnd()} ${stripAnsi(lines[bodyIndex]!).trim()}`;
	const line =
		width !== undefined && visibleWidth(mergedLine) > width ? truncateToWidth(mergedLine, width, "") : mergedLine;
	return [...lines.slice(0, labelIndex), line, ...lines.slice(bodyIndex + 1)];
}
