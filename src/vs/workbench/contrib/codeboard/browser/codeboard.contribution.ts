/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/codeboardSidebar.css';
import { addDisposableListener, EventType } from '../../../../base/browser/dom.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import * as nls from '../../../../nls.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { IViewPaneOptions, ViewPane } from '../../../browser/parts/views/viewPane.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { EditorExtensions } from '../../../common/editor.js';
import { Extensions as ViewExtensions, IViewContainersRegistry, IViewDescriptor, IViewDescriptorService, IViewsRegistry, ViewContainerLocation } from '../../../common/views.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IPaneCompositePartService } from '../../../services/panecomposite/browser/panecomposite.js';
import { CodeBoardEditor } from './codeboardEditor.js';
import { CodeBoardEditorInput } from './codeboardEditorInput.js';

export const BOARD_VIEWLET_ID = 'workbench.view.codeboard';
export const BOARD_VIEW_ID = 'workbench.views.codeboard.board';
const CREATE_SHAPE_COMMAND_ID = 'codeboard.createShapeObject';
const CREATE_CONTROLS_COMMAND_ID = 'codeboard.createControlsObject';

const codeBoardViewIcon = registerIcon('codeboard-view-icon', Codicon.circuitBoard, nls.localize('codeBoardViewIcon', 'View icon of the CodeBoard board view.'));

class CodeBoardView extends ViewPane {
	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	public override shouldShowWelcome(): boolean {
		return false;
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		container.classList.add('codeboard-sidebar');

		const section = document.createElement('div');
		section.className = 'codeboard-sidebar-section';

		const heading = document.createElement('div');
		heading.className = 'codeboard-sidebar-heading';
		heading.textContent = nls.localize('codeboardSidebarHeading', "Code Objects");

		const description = document.createElement('div');
		description.className = 'codeboard-sidebar-description';
		description.textContent = nls.localize('codeboardSidebarDescription', "Create the visual shell and controls for code-linked parts from the workspace tab.");

		const actions = document.createElement('div');
		actions.className = 'codeboard-sidebar-actions';

		actions.appendChild(this.createCreationButton(
			nls.localize('codeboardCreateShapeTitle', "Shape"),
			nls.localize('codeboardCreateShapeDescription', "Code object shell"),
			CREATE_SHAPE_COMMAND_ID
		));
		actions.appendChild(this.createCreationButton(
			nls.localize('codeboardCreateControlsTitle', "Controls"),
			nls.localize('codeboardCreateControlsDescription', "Parameter panel"),
			CREATE_CONTROLS_COMMAND_ID
		));

		const footer = document.createElement('div');
		footer.className = 'codeboard-sidebar-footer';
		footer.textContent = nls.localize('codeboardSidebarFooter', "Board-native items like text, notes, and graphs stay on the canvas toolbar.");

		section.appendChild(heading);
		section.appendChild(description);
		section.appendChild(actions);
		section.appendChild(footer);
		container.appendChild(section);
	}

	private createCreationButton(title: string, description: string, commandId: string): HTMLElement {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'codeboard-sidebar-button';
		button.setAttribute('aria-label', title);

		const titleElement = document.createElement('div');
		titleElement.className = 'codeboard-sidebar-button-title';
		titleElement.textContent = title;

		const descriptionElement = document.createElement('div');
		descriptionElement.className = 'codeboard-sidebar-button-description';
		descriptionElement.textContent = description;

		button.appendChild(titleElement);
		button.appendChild(descriptionElement);
		this._register(addDisposableListener(button, EventType.CLICK, () => this.commandService.executeCommand(commandId)));

		return button;
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

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(CodeBoardEditor, CodeBoardEditor.ID, nls.localize('codeboardEditor', "Project Board")),
	[new SyncDescriptor(CodeBoardEditorInput)]
);

function registerCreateBoardObjectCommand(commandId: string, kind: 'shape' | 'controls', description: string): void {
	CommandsRegistry.registerCommand({
		id: commandId,
		metadata: {
			description,
		},
		handler: async accessor => {
			const editorService = accessor.get(IEditorService);
			await editorService.openEditor(CodeBoardEditorInput.instance, {
				pinned: true,
				revealIfOpened: true,
			});

			CodeBoardEditor.getActiveInstance()?.createWorkspaceObject(kind);
		},
	});
}

registerCreateBoardObjectCommand(CREATE_SHAPE_COMMAND_ID, 'shape', nls.localize('codeboardCreateShapeCommand', "Create a code shape object on the CodeBoard"));
registerCreateBoardObjectCommand(CREATE_CONTROLS_COMMAND_ID, 'controls', nls.localize('codeboardCreateControlsCommand', "Create a controls object on the CodeBoard"));

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
