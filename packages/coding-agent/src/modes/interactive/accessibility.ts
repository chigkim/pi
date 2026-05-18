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

export function mergeScreenReaderLabelWithBody(lines: string[]): string[] {
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

	return [
		...lines.slice(0, labelIndex),
		`${lines[labelIndex]!.trimEnd()} ${lines[bodyIndex]!.trimStart()}`,
		...lines.slice(bodyIndex + 1),
	];
}
