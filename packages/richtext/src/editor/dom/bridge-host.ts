/** The `BridgeHost` the DOM blocks hand the surface bridges: the editor, with focus routed through the view. */

import type { BridgeHost } from '../bridge.js';
import type { EditorView } from './context.js';

export function bridgeHost(view: EditorView): BridgeHost {
    const { editor } = view;
    return {
        dispatch: editor.dispatch,
        runKey: editor.runKey,
        setSelection: editor.setSelection,
        paste: editor.paste,
        flatOf: editor.flatOf,
        schema: editor.schema,
        valueOf: editor.valueOf,
        focused: editor.focused,
        storedMarks: () => editor.state.storedMarks,
    };
}
