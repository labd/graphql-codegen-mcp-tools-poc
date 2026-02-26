/**
 * Strip @mcpTool and @mcpToolVariable directives from a query string.
 * These directives are only used for codegen and not recognized by the GraphQL server.
 *
 * Uses balanced parenthesis matching to handle nested parentheses in directive
 * arguments (e.g., descriptions containing parentheses like "(format: 'id:version')").
 */
export function stripMcpDirectives(query: string): string {
	const findMatchingClosingParenthesis = (
		str: string,
		start: number,
	): number => {
		let depth = 0;
		let inString = false;
		let stringChar = "";

		for (let i = start; i < str.length; i++) {
			const char = str[i];

			if ((char === '"' || char === "'") && str[i - 1] !== "\\") {
				if (!inString) {
					inString = true;
					stringChar = char;
				} else if (char === stringChar) {
					inString = false;
				}
				continue;
			}

			if (inString) continue;

			if (char === "(") depth++;
			if (char === ")") {
				depth--;
				if (depth === 0) return i + 1;
			}
		}
		return -1;
	};

	const removeDirectiveOccurrences = (
		str: string,
		directiveName: string,
	): string => {
		const pattern = new RegExp(`@${directiveName}(?![a-zA-Z])`, "g");
		let result = str;

		const matches: { start: number; end: number }[] = [];
		for (
			let match = pattern.exec(str);
			match !== null;
			match = pattern.exec(str)
		) {
			const directiveStart = match.index;
			let directiveEnd = directiveStart + match[0].length;

			const afterDirective = str.slice(directiveEnd);
			const argsMatch = afterDirective.match(/^\s*\(/);

			if (argsMatch && argsMatch.index !== undefined) {
				const parenStart = directiveEnd + argsMatch.index;
				const parenEnd = findMatchingClosingParenthesis(str, parenStart);
				if (parenEnd > 0) {
					directiveEnd = parenEnd;
				}
			}

			const trailing = str.slice(directiveEnd).match(/^[\s,]*/);
			if (trailing) {
				directiveEnd += trailing[0].length;
			}

			matches.push({ start: directiveStart, end: directiveEnd });
		}

		for (let i = matches.length - 1; i >= 0; i--) {
			const { start, end } = matches[i];
			result = result.slice(0, start) + result.slice(end);
		}

		return result;
	};

	return removeDirectiveOccurrences(
		removeDirectiveOccurrences(query, "mcpToolVariable"),
		"mcpTool",
	);
}
