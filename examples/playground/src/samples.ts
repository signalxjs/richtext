/**
 * The Lab's sample documents, in markdown. Picking one while HTML is the
 * source format converts it through `toHtml` first.
 */

export type SampleId = 'kitchen-sink' | 'chat' | 'tables' | 'code';

export interface Sample {
    id: SampleId;
    label: string;
    source: string;
}

const KITCHEN_SINK = `# @sigx/richtext playground

Markdown for **SignalX** — an *incremental* parser that keeps finalized blocks
stable while the source grows, a serializer, and a DOM view styled through
\`data-part\` attributes. Read the [docs](https://sigx.dev/markdown/) or ping
@[Andy](u1) with questions.

## Lists

- Blocks keep their identity while streaming
- Inline: *emphasis*, **strong**, ~~strike~~, \`code\`, <https://sigx.dev>
  - Nested items work too
  - And a [relative link](/guide) that stays in the app
- Images: ![SignalX](/signalx-logo-150x119.png)

1. Parse
2. Render
3. Serialize

### Tasks

- [x] Parser
- [x] DOM view
- [ ] Editor

## Code

\`\`\`ts
export function greet(name: string): string {
    const now = new Date();
    return \`Hello, \${name}! It is \${now.toLocaleTimeString()}.\`;
}
\`\`\`

> A blockquote, with **strong** text inside it.
> It spans two lines.

## Table

| Entry | Runs on | Notes |
|:------|:-------:|------:|
| \`.\` | everywhere | parser, serializer, engine |
| \`./dom\` | web | \`RichTextView\` |
| \`./shiki\` | web | optional highlighting |

---

That's it. Edit the source on the left; hit **Stream** to replay it token by token.
`;

const CHAT = `Sure — here's how to stream an answer into a **SignalX** view without flicker.

1. Create a text stream and hand its value to the view:

   \`\`\`tsx
   const stream = createTextStream();
   <RichTextView format={markdownFormat} value={stream.value.value} />
   \`\`\`

2. Append tokens as they arrive: \`stream.append(token)\`.
3. Call \`stream.done()\` when the model stops.

Finalized blocks keep their key, so the reconciler never remounts them — only
the paragraph still being written re-renders. Ask @[Bea](u2) if you want the
Lynx version.

> **Tip:** throttle with \`flushIntervalMs\` if tokens arrive faster than frames.
`;

const TABLES = `# GFM tables

| Package | Entry | Runs on |
|:--------|:------|:-------:|
| \`@sigx/richtext\` | \`.\` | everywhere |
| \`@sigx/richtext\` | \`./dom\` | web |
| \`@sigx/richtext-markdown\` | \`.\` | everywhere |
| \`@sigx/richtext-html\` | \`.\` | everywhere |
| \`@sigx/richtext-shiki\` | \`.\` | web |

A table stays **open** until the line after its last row, because another
row could still arrive.

| Align | left | center | right |
|:------|:-----|:------:|------:|
| a | 1 | 2 | 3 |
| *emphasis* | **strong** | \`code\` | ~~strike~~ |

- [x] Header row and delimiter row
- [x] Alignment
- [ ] Row spans (not in GFM)
`;

const CODE = `# A long code block

A fenced block is open until its closing fence arrives, so it streams as one
growing block and finalizes all at once.

\`\`\`ts
import { createTextStream } from '@sigx/richtext';
import { createIncrementalEngine, toMarkdown } from '@sigx/richtext-markdown';

interface Tick {
    chunk: string;
    at: number;
}

/** Replay \`source\` in \`size\`-character chunks, one every \`every\` ms. */
export async function* replay(source: string, size = 3, every = 16): AsyncGenerator<Tick> {
    for (let i = 0; i < source.length; i += size) {
        await new Promise((resolve) => setTimeout(resolve, every));
        yield { chunk: source.slice(i, i + size), at: performance.now() };
    }
}

export async function measure(source: string): Promise<number[]> {
    const engine = createIncrementalEngine();
    const stream = createTextStream();
    const timings: number[] = [];
    for await (const { chunk } of replay(source)) {
        stream.append(chunk);
        const t0 = performance.now();
        engine.parse(stream.value.value);
        timings.push(performance.now() - t0);
    }
    stream.done();
    const { finalized, cut } = engine.inspect();
    console.log(\`\${finalized} finalized blocks, cut at \${cut}\`);
    console.log(toMarkdown(engine.parse(stream.value.value)));
    return timings;
}
\`\`\`

The paragraph after the fence starts a new block.
`;

export const SAMPLES: readonly Sample[] = [
    { id: 'kitchen-sink', label: 'Kitchen sink', source: KITCHEN_SINK },
    { id: 'chat', label: 'Chat answer', source: CHAT },
    { id: 'tables', label: 'GFM tables', source: TABLES },
    { id: 'code', label: 'Long code block', source: CODE },
];
