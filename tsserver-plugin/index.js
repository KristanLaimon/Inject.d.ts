const fs = require('fs');
const path = require('path');

function resolvePluginBundle() {
	let directory = __dirname;

	while (true) {
		const candidate = path.join(directory, 'dist', 'tsserver-plugin.js');
		if (fs.existsSync(candidate)) {
			return candidate;
		}

		const parent = path.dirname(directory);
		if (parent === directory) {
			throw new Error('Could not find Inject.d.ts tsserver plugin bundle.');
		}
		directory = parent;
	}
}

module.exports = require(resolvePluginBundle());
