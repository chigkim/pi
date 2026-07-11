import { afterEach, describe, expect, test } from "vitest";
import {
	getSelectionPrefix,
	setScreenReaderMode,
	trimScreenReaderBlock,
} from "../src/modes/interactive/accessibility.ts";

describe("screen reader accessibility", () => {
	afterEach(() => {
		setScreenReaderMode(undefined);
	});

	test("returns the caller's glyph in normal mode", () => {
		expect(getSelectionPrefix()).toBe("→ ");
		expect(getSelectionPrefix("› ")).toBe("› ");
	});

	test("returns the ASCII prefix in flat screen reader mode regardless of the caller's glyph", () => {
		setScreenReaderMode("flat");
		expect(getSelectionPrefix()).toBe("> ");
		expect(getSelectionPrefix("› ")).toBe("> ");
	});

	test("suppresses empty HTML comment boundaries in flat screen reader mode", () => {
		setScreenReaderMode("flat");

		expect(trimScreenReaderBlock(["Thinking: tracing", "", "<!-- -->", "", "Tool: read file"])).toEqual([
			"Thinking: tracing",
			"",
			"",
			"",
			"Tool: read file",
		]);
		expect(trimScreenReaderBlock(["<!-- boundary -->"])).toEqual(["<!-- boundary -->"]);
	});
});
