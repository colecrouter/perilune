# Klipper template grammar

Adapted from CodeMirror's MIT-licensed `lang-jinja`, GitHub mirror commit
`ae2c2fd5b73137c444021ebfa99d40fffccb66d6` (src/jinja.grammar and src/tokens.ts).
Upstream: https://code.haverbeke.berlin/codemirror/lang-jinja
Mirror: https://github.com/codemirror/lang-jinja
The upstream MIT notice is preserved in LICENSE.

Changes: interpolation begins with one `{` and closes with `}` as configured by
Klipper's Jinja environment; dictionary braces share the normal expression token;
comma-separated expressions accept trailing commas; capture blocks accept filters. HTML nesting and automatic
percent-brace insertion are deliberately omitted. Configuration comments are
masked before analysis, following Klipper's configuration reader.

Run `pnpm generate:config-language` with the frozen lockfile to reproduce parser.ts
and parser.terms.ts. Generated files are committed; deployment does not generate
or download a parser. The generator is a development dependency.

This grammar provides highlighting and advisory parse feedback. Independent
conservative delimiter/block checks provide explicit structural errors. Grammar
recovery errors are warnings because this is not the full Python Jinja compiler
or a validator for the connected printer's installed modules/version. No template
is evaluated and no command is sent by language assistance.
