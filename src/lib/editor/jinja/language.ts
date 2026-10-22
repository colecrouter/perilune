import { styleTags, tags } from '@lezer/highlight';
import { parser as rawParser } from './parser.js';
/** Shared syntax tree for assistance/highlighting; never executes templates. */
export const parser = rawParser.configure({
	props: [
		styleTags({
			'TagName if elif else endif for endfor set endset raw endraw macro endmacro with endwith in is not and or':
				tags.keyword,
			VariableName: tags.variableName,
			Definition: tags.definition(tags.variableName),
			PropertyName: tags.propertyName,
			FilterName: tags.function(tags.variableName),
			StringLiteral: tags.string,
			NumberLiteral: tags.number,
			BooleanLiteral: tags.bool,
			'Comment/...': tags.blockComment,
			'ArithOp CompareOp AssignOp FilterOp ConcatOp': tags.operator,
			'{ } {% %} {# #}': tags.brace
		})
	]
});
