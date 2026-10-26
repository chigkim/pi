import assert from "node:assert";
import { afterEach, describe, it } from "node:test";
import { Box } from "../src/components/box.ts";
import { Markdown } from "../src/components/markdown.ts";
import { Text } from "../src/components/text.ts";
import { type Component, CURSOR_MARKER } from "../src/tui.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { setComponentWrapping, splitTerminalRows } from "../src/utils.ts";
import { defaultMarkdownTheme } from "./test-themes.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

class TestComponent implements Component {
	lines: string[] = [];
	render(_width: number): string[] {
		return this.lines;
	}
	invalidate(): void {}
}

async function setup(columns: number, rows: number, lines: string[]) {
	const terminal = new VirtualTerminal(columns, rows);
	const tui = new TuiMainScreen(terminal);
	tui.setTerminalWrap(true);
	const component = new TestComponent();
	component.lines = lines;
	tui.addChild(component);
	tui.start();
	tui.renderNow();
	await terminal.flush();
	return { terminal, tui, component };
}

async function update(
	terminal: VirtualTerminal,
	tui: TuiMainScreen,
	component: TestComponent,
	lines: string[],
): Promise<void> {
	component.lines = lines;
	tui.renderNow();
	await terminal.flush();
}

/** Scroll buffer lines with the terminal's soft wraps joined, so each entry is one logical line. */
function logicalLines(terminal: VirtualTerminal): string[] {
	const rows = terminal.getScrollBuffer();
	const wrapped = terminal.getWrappedFlags();
	const lines: string[] = [];
	for (let i = 0; i < rows.length; i++) {
		if (wrapped[i] && lines.length > 0) lines[lines.length - 1] += rows[i];
		else lines.push(rows[i]!);
	}
	while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
	return lines;
}

// No spaces: the terminal buffer drops trailing spaces of each row.
const long = (length: number, char = "x") => char.repeat(length);

describe("splitTerminalRows", () => {
	it("returns a line that fits unchanged", () => {
		assert.deepStrictEqual(splitTerminalRows("abc", 3), ["abc"]);
	});

	it("moves a wide character that does not fit to the next row", () => {
		assert.deepStrictEqual(splitTerminalRows("abcd\u4e2def", 5), ["abcd\x1b[0m", "\u4e2def"]);
	});

	it("carries styles to the next row", () => {
		assert.deepStrictEqual(splitTerminalRows("\x1b[1mabcdef\x1b[22m", 3), [
			"\x1b[1mabc\x1b[0m",
			"\x1b[1mdef\x1b[22m",
		]);
	});
});

describe("components without wrapping", () => {
	afterEach(() => setComponentWrapping(true));

	const source = "Intro paragraph that is longer than the width.\n\n- item\n    - nested **item** that is long";

	it("Text keeps lines whole and adds no margin", () => {
		setComponentWrapping(false);
		const lines = new Text(source, 1, 0).render(20).map((line) => line.trimEnd());
		assert.deepStrictEqual(lines, source.split("\n"));
	});

	it("Markdown shows its source unrendered, unwrapped, and without margins", () => {
		setComponentWrapping(false);
		const lines = new Markdown(source, 2, 0, defaultMarkdownTheme).render(20);
		assert.deepStrictEqual(lines, source.split("\n"));
	});

	it("replaces a tab with 2 spaces, and with 3 when wrapping", () => {
		setComponentWrapping(false);
		assert.deepStrictEqual(new Text("\ta", 0, 0).render(20)[0]!.trimEnd(), "  a");
		assert.deepStrictEqual(new Markdown("\ta", 0, 0, defaultMarkdownTheme).render(20), ["  a"]);
		setComponentWrapping(true);
		assert.deepStrictEqual(new Text("\ta", 0, 0).render(20)[0]!.trimEnd(), "   a");
	});

	it("writes a tab that reaches the renderer as 2 spaces", async () => {
		setComponentWrapping(false);
		const { terminal, tui } = await setup(20, 5, ["\ta"]);
		assert.deepStrictEqual(logicalLines(terminal), ["  a"]);
		tui.stop();
	});

	it("Box adds no margin", () => {
		setComponentWrapping(false);
		const box = new Box(2, 0);
		box.addChild(new Text("  indented line longer than the width", 0, 0));
		assert.deepStrictEqual(
			box.render(20).map((line) => line.trimEnd()),
			["  indented line longer than the width"],
		);
	});
});

describe("TUI terminal wrap", () => {
	it("writes a wide line as one line the terminal wraps", async () => {
		const line = long(50);
		const { terminal, tui } = await setup(20, 10, ["before", line, "after"]);
		assert.deepStrictEqual(logicalLines(terminal), ["before", line, "after"]);
		assert.deepStrictEqual(terminal.getWrappedFlags().slice(0, 6), [false, false, true, true, false, false]);
		tui.stop();
	});

	it("grows and shrinks a wrapped line in place", async () => {
		const { terminal, tui, component } = await setup(20, 10, ["before", long(30), "after"]);
		const redraws = tui.fullRedraws;

		await update(terminal, tui, component, ["before", long(65), "after"]);
		assert.deepStrictEqual(logicalLines(terminal), ["before", long(65), "after"]);

		await update(terminal, tui, component, ["before", long(25, "y"), "after"]);
		assert.deepStrictEqual(logicalLines(terminal), ["before", long(25, "y"), "after"]);
		assert.deepStrictEqual(terminal.getWrappedFlags().slice(0, 5), [false, false, true, false, false]);
		assert.strictEqual(tui.fullRedraws, redraws);
		tui.stop();
	});

	it("clears the old end of a wrapped line when only its last row changes", async () => {
		const { terminal, tui, component } = await setup(20, 10, ["before", long(45), "after"]);
		await update(terminal, tui, component, ["before", long(42), "after"]);
		assert.deepStrictEqual(logicalLines(terminal), ["before", long(42), "after"]);
		tui.stop();
	});

	it("keeps a line that ends on the last column intact", async () => {
		const { terminal, tui, component } = await setup(20, 10, ["before", long(40), "after"]);
		await update(terminal, tui, component, ["before", long(40, "y"), "after"]);
		assert.deepStrictEqual(logicalLines(terminal), ["before", long(40, "y"), "after"]);
		tui.stop();
	});

	it("updates a streamed line that starts above the viewport without a full redraw", async () => {
		// The line takes 4 rows and the terminal has 3, so its first row is in scrollback.
		const { terminal, tui, component } = await setup(10, 3, ["a", long(35)]);
		const redraws = tui.fullRedraws;

		await update(terminal, tui, component, ["a", long(38)]);
		assert.deepStrictEqual(logicalLines(terminal), ["a", long(38)]);
		assert.strictEqual(tui.fullRedraws, redraws);
		tui.stop();
	});

	it("places the cursor on the row of a wrapped line that holds the marker", async () => {
		const { terminal, tui } = await setup(10, 5, ["a", `${"x".repeat(13)}${CURSOR_MARKER}y`]);
		tui.setShowHardwareCursor(true);
		tui.renderNow();
		await terminal.flush();
		assert.deepStrictEqual(terminal.getCursorPosition(), { x: 3, y: 2 });
		tui.stop();
	});
});
