import { StreamLanguage, type StreamParser } from '@codemirror/language';
interface State {
	template: string | null;
}
/** Highlighting only: firmware remains responsible for validating Klipper syntax. */
export const klipperParser: StreamParser<State> = {
	startState: () => ({ template: null }),
	token(stream, state) {
		if (stream.eatSpace()) return null;
		if (state.template) {
			if (stream.match(state.template)) {
				state.template = null;
				return 'meta';
			}
			if (stream.match(/^(if|else|elif|endif|for|in|endfor|set|and|or|not|true|false|none)\b/i))
				return 'keyword';
			if (stream.match(/^"(?:[^"\\]|\\.)*"|^'(?:[^'\\]|\\.)*'/)) return 'string';
			if (stream.match(/^\d+(?:\.\d+)?/)) return 'number';
			stream.next();
			return 'variableName';
		}
		if (stream.match(/^\{[%#]/)) {
			state.template = stream.current() === '{#' ? '#}' : '%}';
			return 'meta';
		}
		if (stream.match('{{')) {
			state.template = '}}';
			return 'meta';
		}
		if (stream.match('{')) {
			state.template = '}';
			return 'meta';
		}
		if (stream.match(/^[#;].*/)) return 'comment';
		if (stream.sol() && stream.match(/^\[[^\]]+\]/)) return 'heading';
		if (stream.match(/^[a-z_][\w]*\s*[:=]/i)) return 'propertyName';
		if (stream.match(/^(?:[GMT]\d+(?:\.\d+)?|[A-Z_]{2,})\b/)) return 'keyword';
		if (stream.match(/^"(?:[^"\\]|\\.)*"|^'(?:[^'\\]|\\.)*'/)) return 'string';
		if (stream.match(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)\b/)) return 'number';
		stream.next();
		return null;
	},
	languageData: { commentTokens: { line: '#' } }
};
export const klipper = StreamLanguage.define(klipperParser);
