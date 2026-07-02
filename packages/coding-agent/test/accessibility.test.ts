import { afterEach, describe, expect, test } from "vitest";
import { getSelectionPrefix, setScreenReaderMode } from "../src/modes/interactive/accessibility.ts";

describe("getSelectionPrefix", () => {
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
});
