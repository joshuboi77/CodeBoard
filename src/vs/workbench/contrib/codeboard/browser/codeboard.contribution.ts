/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import * as nls from '../../../../nls.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { ViewPane } from '../../../browser/parts/views/viewPane.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { EditorExtensions } from '../../../common/editor.js';
import { Extensions as ViewExtensions, IViewContainersRegistry, IViewDescriptor, IViewsRegistry, ViewContainerLocation } from '../../../common/views.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IPaneCompositePartService } from '../../../services/panecomposite/browser/panecomposite.js';
import { CodeBoardEditor } from './codeboardEditor.js';
import { CodeBoardEditorInput } from './codeboardEditorInput.js';

export const BOARD_VIEWLET_ID = 'workbench.view.codeboard';
export const BOARD_VIEW_ID = 'workbench.views.codeboard.board';

const codeBoardViewIcon = registerIcon('codeboard-view-icon', Codicon.circuitBoard, nls.localize('codeBoardViewIcon', 'View icon of the CodeBoard board view.'));

class CodeBoardView extends ViewPane {
	public override shouldShowWelcome(): boolean {
		return true;
	}
}

const viewContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
	id: BOARD_VIEWLET_ID,
	title: nls.localize2('codeboardViewlet', "Board"),
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [BOARD_VIEWLET_ID, { mergeViewWithContainerWhenSingleView: true }]),
	icon: codeBoardViewIcon,
	order: 6,
}, ViewContainerLocation.Sidebar);

const viewDescriptor: IViewDescriptor = {
	id: BOARD_VIEW_ID,
	containerIcon: codeBoardViewIcon,
	name: nls.localize2('codeboardView', "Board"),
	ctorDescriptor: new SyncDescriptor(CodeBoardView),
	canToggleVisibility: false,
	canMoveView: true,
};

Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([viewDescriptor], viewContainer);

Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViewWelcomeContent(BOARD_VIEW_ID, {
	content: nls.localize('codeboardWelcome', "CodeBoard board workspace will appear here."),
});

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(CodeBoardEditor, CodeBoardEditor.ID, nls.localize('codeboardEditor', "Project Board")),
	[new SyncDescriptor(CodeBoardEditorInput)]
);

class CodeBoardEditorContribution extends Disposable {
	static readonly ID = 'workbench.contrib.codeboardEditor';

	constructor(
		@IPaneCompositePartService paneCompositePartService: IPaneCompositePartService,
		@IEditorService editorService: IEditorService,
	) {
		super();

		this._register(paneCompositePartService.onDidPaneCompositeOpen(async e => {
			if (e.viewContainerLocation !== ViewContainerLocation.Sidebar || e.composite.getId() !== BOARD_VIEWLET_ID) {
				return;
			}

			await editorService.openEditor(CodeBoardEditorInput.instance, {
				pinned: true,
				revealIfOpened: true,
			});
		}));
	}
}

registerWorkbenchContribution2(CodeBoardEditorContribution.ID, CodeBoardEditorContribution, WorkbenchPhase.AfterRestored);
