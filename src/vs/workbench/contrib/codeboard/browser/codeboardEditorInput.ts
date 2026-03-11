/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';

const codeBoardEditorIcon = registerIcon('codeboard-editor-label-icon', Codicon.circuitBoard, localize('codeBoardEditorLabelIcon', 'Icon of the CodeBoard editor label.'));

export class CodeBoardEditorInput extends EditorInput {

	static readonly ID = 'workbench.editor.codeboardInput';

	static readonly RESOURCE = URI.from({
		scheme: 'codeboard-board',
		path: '/project-board'
	});

	private static _instance: CodeBoardEditorInput;

	static get instance(): CodeBoardEditorInput {
		if (!CodeBoardEditorInput._instance || CodeBoardEditorInput._instance.isDisposed()) {
			CodeBoardEditorInput._instance = new CodeBoardEditorInput();
		}

		return CodeBoardEditorInput._instance;
	}

	override get typeId(): string {
		return CodeBoardEditorInput.ID;
	}

	override get editorId(): string | undefined {
		return CodeBoardEditorInput.ID;
	}

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton;
	}

	readonly resource = CodeBoardEditorInput.RESOURCE;

	override getName(): string {
		return localize('codeBoardInputName', "Project Board");
	}

	override getIcon(): ThemeIcon {
		return codeBoardEditorIcon;
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		if (super.matches(other)) {
			return true;
		}

		return other instanceof CodeBoardEditorInput;
	}
}
