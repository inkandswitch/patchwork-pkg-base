export const plugins = [
	{
		type: "patchwork:tool",
		tags: ["titlebar-tool"],
		id: "spacer",
		name: "Spacer",
		icon: "Spacer",
		supportedDatatypes: "*",
		async load() {
			return (_handle, _element) => () => {}
		},
		unlisted: true,
		forTitleBar: true,
	},
]
