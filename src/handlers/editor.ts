// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { CodeEditor } from '@jupyterlab/codeeditor';

import { CodeMirrorEditor } from '@jupyterlab/codemirror';

import { ActivityMonitor } from '@jupyterlab/coreutils';

import { IObservableString } from '@jupyterlab/observables';

import { IDisposable } from '@phosphor/disposable';

import { Signal } from '@phosphor/signaling';

import { Editor } from 'codemirror';

import { Debugger } from '../debugger';

import { IDebugger } from '../tokens';

import { BreakpointsModel } from '../breakpoints/model';

const LINE_HIGHLIGHT_CLASS = 'jp-DebuggerEditor-highlight';

const EDITOR_CHANGED_TIMEOUT = 1000;

/**
 * A handler for a CodeEditor.IEditor.
 */
export class EditorHandler implements IDisposable {
  /**
   * Instantiate a new EditorHandler.
   * @param options The instantiation options for a EditorHandler.
   */
  constructor(options: EditorHandler.IOptions) {
    this._id = options.debuggerService.session.client.path;
    this._path = options.path;
    this._debuggerService = options.debuggerService;
    this._editor = options.editor;

    this._onModelChanged();
    this._debuggerService.modelChanged.connect(this._onModelChanged, this);

    this._editorMonitor = new ActivityMonitor({
      signal: this._editor.model.value.changed,
      timeout: EDITOR_CHANGED_TIMEOUT
    });

    this._editorMonitor.activityStopped.connect(() => {
      this._sendEditorBreakpoints();
    }, this);

    this._setupEditor();
  }

  /**
   * Whether the handler is disposed.
   */
  isDisposed: boolean;

  /**
   * Dispose the handler.
   */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this._editorMonitor.dispose();
    this._clearEditor();
    this.isDisposed = true;
    Signal.clearData(this);
  }

  /**
   * Handle when the debug model changes.
   */
  private _onModelChanged() {
    this._debuggerModel = this._debuggerService.model as Debugger.Model;
    if (!this._debuggerModel) {
      return;
    }
    this._breakpointsModel = this._debuggerModel.breakpoints;

    this._debuggerModel.callstack.currentFrameChanged.connect(() => {
      EditorHandler.clearHighlight(this._editor);
    });

    this._breakpointsModel.changed.connect(async () => {
      if (!this._editor || this._editor.isDisposed) {
        return;
      }
      this._addBreakpointsToEditor();
    });

    this._breakpointsModel.restored.connect(async () => {
      if (!this._editor || this._editor.isDisposed) {
        return;
      }
      this._addBreakpointsToEditor();
    });
  }

  /**
   * Setup the editor.
   */
  private _setupEditor() {
    if (!this._editor || this._editor.isDisposed) {
      return;
    }

    this._addBreakpointsToEditor();

    const editor = this._editor as CodeMirrorEditor;
    editor.setOption('lineNumbers', true);
    editor.editor.setOption('gutters', [
      'CodeMirror-linenumbers',
      'breakpoints'
    ]);
    editor.editor.on('gutterClick', this.onGutterClick);
  }

  /**
   * Clear the editor by removing visual elements and handlers.
   */
  private _clearEditor() {
    if (!this._editor || this._editor.isDisposed) {
      return;
    }
    const editor = this._editor as CodeMirrorEditor;
    EditorHandler.clearHighlight(editor);
    EditorHandler.clearGutter(editor);
    editor.setOption('lineNumbers', false);
    editor.editor.setOption('gutters', []);
    editor.editor.off('gutterClick', this.onGutterClick);
  }

  /**
   * Send the breakpoints from the editor UI via the debug service.
   */
  private _sendEditorBreakpoints() {
    if (this._editor.isDisposed) {
      return;
    }

    const breakpoints = this._getBreakpointsFromEditor().map(lineInfo => {
      return Private.createBreakpoint(
        this._debuggerService.session.client.name,
        lineInfo.line + 1
      );
    });

    void this._debuggerService.updateBreakpoints(
      this._editor.model.value.text,
      breakpoints,
      this._path
    );
  }

  /**
   * Handle a click on the gutter.
   * @param editor The editor from where the click originated.
   * @param lineNumber The line corresponding to the click event.
   */
  private onGutterClick = (editor: Editor, lineNumber: number) => {
    const info = editor.lineInfo(lineNumber);

    if (!info || this._id !== this._debuggerService.session.client.path) {
      return;
    }

    const remove = !!info.gutterMarkers;
    let breakpoints: IDebugger.IBreakpoint[] = this._getBreakpoints();
    if (remove) {
      breakpoints = breakpoints.filter(ele => ele.line !== info.line + 1);
    } else {
      breakpoints.push(
        Private.createBreakpoint(
          this._path ?? this._debuggerService.session.client.name,
          info.line + 1
        )
      );
    }

    void this._debuggerService.updateBreakpoints(
      this._editor.model.value.text,
      breakpoints,
      this._path
    );
  };

  /**
   * Add the breakpoints to the editor.
   */
  private _addBreakpointsToEditor() {
    const editor = this._editor as CodeMirrorEditor;
    const breakpoints = this._getBreakpoints();
    if (this._id !== this._debuggerService.session.client.path) {
      return;
    }
    EditorHandler.clearGutter(editor);
    breakpoints.forEach(breakpoint => {
      editor.editor.setGutterMarker(
        breakpoint.line - 1,
        'breakpoints',
        Private.createMarkerNode()
      );
    });
  }

  /**
   * Retrieve the breakpoints from the editor.
   */
  private _getBreakpointsFromEditor(): Private.ILineInfo[] {
    const editor = this._editor as CodeMirrorEditor;
    let lines = [];
    for (let i = 0; i < editor.doc.lineCount(); i++) {
      const info = editor.editor.lineInfo(i);
      if (info.gutterMarkers) {
        lines.push(info);
      }
    }
    return lines;
  }

  /**
   * Get the breakpoints for the editor using its content (code),
   * or its path (if it exists).
   */
  private _getBreakpoints(): IDebugger.IBreakpoint[] {
    const code = this._editor.model.value.text;
    return this._debuggerModel.breakpoints.getBreakpoints(
      this._path ?? this._debuggerService.getCodeId(code)
    );
  }

  private _id: string;
  private _path: string;
  private _editor: CodeEditor.IEditor;
  private _debuggerModel: Debugger.Model;
  private _breakpointsModel: BreakpointsModel;
  private _debuggerService: IDebugger;
  private _editorMonitor: ActivityMonitor<
    IObservableString,
    IObservableString.IChangedArgs
  > = null;
}

/**
 * A namespace for EditorHandler `statics`.
 */
export namespace EditorHandler {
  /**
   * Instantiation options for `EditorHandler`.
   */
  export interface IOptions {
    /**
     * The debugger service.
     */
    debuggerService: IDebugger;

    /**
     * The code editor to handle.
     */
    editor: CodeEditor.IEditor;

    /**
     * An optional path to a source file.
     */
    path?: string;
  }

  /**
   * Highlight the current line of the frame in the given editor.
   * @param editor The editor to highlight.
   * @param line The line number.
   */
  export function showCurrentLine(editor: CodeEditor.IEditor, line: number) {
    clearHighlight(editor);
    const cmEditor = editor as CodeMirrorEditor;
    cmEditor.editor.addLineClass(line - 1, 'wrap', LINE_HIGHLIGHT_CLASS);
  }

  /**
   * Remove all line highlighting indicators for the given editor.
   * @param editor The editor to cleanup.
   */
  export function clearHighlight(editor: CodeEditor.IEditor) {
    if (!editor || editor.isDisposed) {
      return;
    }
    const cmEditor = editor as CodeMirrorEditor;
    cmEditor.doc.eachLine(line => {
      cmEditor.editor.removeLineClass(line, 'wrap', LINE_HIGHLIGHT_CLASS);
    });
  }

  /**
   * Remove line numbers and all gutters from editor.
   * @param editor The editor to cleanup.
   */

  export function clearGutter(editor: CodeEditor.IEditor) {
    if (!editor) {
      return;
    }
    const cmEditor = editor as CodeMirrorEditor;
    cmEditor.doc.eachLine(line => {
      if ((line as Private.ILineInfo).gutterMarkers) {
        cmEditor.editor.setGutterMarker(line, 'breakpoints', null);
      }
    });
  }
}

/**
 * A namespace for module private data.
 */
namespace Private {
  /**
   * Create a marker DOM element for a breakpoint.
   */
  export function createMarkerNode() {
    const marker = document.createElement('div');
    marker.className = 'jp-DebuggerEditor-marker';
    marker.innerHTML = '●';
    return marker;
  }

  /**
   *
   * @param session The name of the session.
   * @param line The line number of the breakpoint.
   */
  export function createBreakpoint(session: string, line: number) {
    return {
      line,
      active: true,
      verified: true,
      source: {
        name: session
      }
    };
  }

  /**
   * An interface for an editor line info.
   */
  export interface ILineInfo {
    line: any;
    handle: any;
    text: string;
    /** Object mapping gutter IDs to marker elements. */
    gutterMarkers: any;
    textClass: string;
    bgClass: string;
    wrapClass: string;
    /** Array of line widgets attached to this line. */
    widgets: any;
  }
}
