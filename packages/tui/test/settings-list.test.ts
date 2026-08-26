import assert from "node:assert";
import { describe, it } from "node:test";
import { SettingsList, type SettingsListTheme } from "../src/components/settings-list.ts";

const testTheme: SettingsListTheme = {
	label: (text) => text,
	value: (text) => text,
	description: (text) => text,
	cursor: "> ",
	hint: (text) => text,
};

const items = [
	{
		id: "tui-mode",
		label: "TUI mode",
		currentValue: "regular",
		values: ["regular", "fullscreen"],
	},
];

describe("SettingsList", () => {
	it("includes spaces in an active search instead of changing the selected setting", () => {
		const changes: Array<{ id: string; value: string }> = [];
		const list = new SettingsList(
			items.map((item) => ({ ...item })),
			10,
			testTheme,
			(id, value) => changes.push({ id, value }),
			() => {},
			{ enableSearch: true },
		);

		for (const character of "TUI mode") list.handleInput(character);

		assert.deepStrictEqual(changes, []);
		assert.match(list.render(80)[0] ?? "", /TUI mode/);

		list.handleInput("\r");
		assert.deepStrictEqual(changes, [{ id: "tui-mode", value: "fullscreen" }]);
	});

	it("keeps Space as a change shortcut before a search query is entered", () => {
		const changes: Array<{ id: string; value: string }> = [];
		const list = new SettingsList(
			items.map((item) => ({ ...item })),
			10,
			testTheme,
			(id, value) => changes.push({ id, value }),
			() => {},
			{ enableSearch: true },
		);

		list.handleInput(" ");

		assert.deepStrictEqual(changes, [{ id: "tui-mode", value: "fullscreen" }]);
	});

	it("joins hint segments with a custom separator", () => {
		const list = new SettingsList(
			items.map((item) => ({ ...item })),
			10,
			testTheme,
			() => {},
			() => {},
			{ enableSearch: true, hintSeparator: " - " },
		);

		const hint = list.render(120).find((line) => line.includes("Esc to cancel"));

		assert.ok(hint, "expected a hint line");
		assert.strictEqual(hint.trim(), "Type to search - Enter/Space to change - Esc to cancel");
		assert.ok(!hint.includes("·"), JSON.stringify(hint));
	});

	it("uses the middle dot separator by default", () => {
		const list = new SettingsList(
			items.map((item) => ({ ...item })),
			10,
			testTheme,
			() => {},
			() => {},
		);

		const hint = list.render(120).find((line) => line.includes("Esc to cancel"));

		assert.ok(hint, "expected a hint line");
		assert.ok(hint.includes("·"), JSON.stringify(hint));
	});
});
