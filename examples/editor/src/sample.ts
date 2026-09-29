/** The document the showcase opens with: the design's "streaming renderer" notes. */
export const SAMPLE = `# Streaming renderer

The engine keeps **finalized blocks stable** while the source string grows, so a chat answer
can render *token by token* without re-laying out what the reader has already seen.

## How a block settles

1. The line engine reads the growing string and closes a block at its first blank line.
2. A closed block is **final**: its node, its key and its DOM stay put.
3. Only the open tail is parsed again on the next token.

> *One plugin contract feeds every format, every renderer and the editor.*

\`\`\`ts
import { createIncrementalEngine } from '@sigx/richtext-markdown'

const engine = createIncrementalEngine()
let source = ''
for await (const chunk of stream) {
  source += chunk
  render(engine.parse(source)) // finalized blocks are reused
}
\`\`\`

## Format support

Both codecs read into the same mdast-shaped tree — see the [CommonMark spec](https://spec.commonmark.org/)
for the reference layout.

| Format | Parse | Serialize | Streaming |
|:-------|:-----:|:---------:|:---------:|
| Markdown | yes | yes | incremental |
| HTML | yes | yes | re-parse |

## Open items

- [x] Toolbar, slash menu and link popover
- [x] Split and source views
- [ ] Ask @[Bea](u2) about collaborative cursors
`;
