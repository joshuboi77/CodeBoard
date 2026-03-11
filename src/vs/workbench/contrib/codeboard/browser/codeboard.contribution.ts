/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/codeboardSidebar.css';
import { IListVirtualDelegate } from '../../../../base/browser/ui/list/list.js';
import { ICompressedTreeNode } from '../../../../base/browser/ui/tree/compressedObjectTreeModel.js';
import { ICompressibleTreeRenderer } from '../../../../base/browser/ui/tree/objectTree.js';
import { IAsyncDataSource, ITreeNode } from '../../../../base/browser/ui/tree/tree.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { basenameOrAuthority, extUriBiasedIgnorePathCase } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import * as nls from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { FileKind, IFileService, IFileStat } from '../../../../platform/files/common/files.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { WorkbenchCompressibleAsyncDataTree } from '../../../../platform/list/browser/listService.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { IResourceLabel, ResourceLabels } from '../../../browser/labels.js';
import { IViewPaneOptions, ViewPane } from '../../../browser/parts/views/viewPane.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { EditorExtensions } from '../../../common/editor.js';
import { Extensions as ViewExtensions, IViewContainersRegistry, IViewDescriptor, IViewDescriptorService, IViewsRegistry, ViewContainerLocation } from '../../../common/views.js';
import { createFileIconThemableTreeContainerScope } from '../../../contrib/files/browser/views/explorerView.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IPaneCompositePartService } from '../../../services/panecomposite/browser/panecomposite.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { CodeBoardEditor } from './codeboardEditor.js';
import { CodeBoardEditorInput } from './codeboardEditorInput.js';

export const BOARD_VIEWLET_ID = 'workbench.view.codeboard';
export const BOARD_VIEW_ID = 'workbench.views.codeboard.board';

const CODEBOARD_CODE_FILE_EXTENSIONS = new Set([
	'.rs',
	'.ts',
	'.tsx',
	'.js',
	'.jsx',
	'.py',
	'.c',
	'.cc',
	'.cpp',
	'.h',
	'.hpp',
	'.java',
	'.go',
]);

const CODEBOARD_IGNORED_DIRECTORY_NAMES = new Set([
	'.git',
	'.hg',
	'.svn',
	'node_modules',
	'dist',
	'build',
	'out',
	'target',
	'coverage',
]);

const codeBoardViewIcon = registerIcon('codeboard-view-icon', Codicon.circuitBoard, nls.localize('codeBoardViewIcon', 'View icon of the CodeBoard board view.'));

interface ICodeBoardWorkspaceFileEntry {
	readonly label: string;
	readonly resource: URI;
}

interface ICodeBoardWorkspaceTreeItem extends ICodeBoardWorkspaceFileEntry {
	readonly name: string;
	readonly isDirectory: boolean;
	readonly isRoot: boolean;
	readonly rootUri: URI;
}

class CodeBoardWorkspaceTreeDataSource implements IAsyncDataSource<ICodeBoardWorkspaceTreeItem[], ICodeBoardWorkspaceTreeItem> {
	private readonly childrenCache = new Map<string, Promise<ICodeBoardWorkspaceTreeItem[]>>();
	private readonly hasCodeDescendantCache = new Map<string, Promise<boolean>>();

	constructor(
		@IFileService private readonly fileService: IFileService,
	) { }

	hasChildren(element: ICodeBoardWorkspaceTreeItem[] | ICodeBoardWorkspaceTreeItem): boolean {
		return Array.isArray(element) || element.isDirectory;
	}

	async getChildren(element: ICodeBoardWorkspaceTreeItem[] | ICodeBoardWorkspaceTreeItem): Promise<ICodeBoardWorkspaceTreeItem[]> {
		if (Array.isArray(element)) {
			return element;
		}

		const cacheKey = element.resource.toString();
		let childrenPromise = this.childrenCache.get(cacheKey);
		if (!childrenPromise) {
			childrenPromise = this.resolveVisibleChildren(element);
			this.childrenCache.set(cacheKey, childrenPromise);
		}

		return childrenPromise;
	}

	async hasSupportedFiles(resource: URI): Promise<boolean> {
		const cacheKey = resource.toString();
		let result = this.hasCodeDescendantCache.get(cacheKey);
		if (!result) {
			result = this.computeHasSupportedFiles(resource);
			this.hasCodeDescendantCache.set(cacheKey, result);
		}

		return result;
	}

	private async resolveVisibleChildren(parent: ICodeBoardWorkspaceTreeItem): Promise<ICodeBoardWorkspaceTreeItem[]> {
		const stat = await this.fileService.resolve(parent.resource);
		const entries: ICodeBoardWorkspaceTreeItem[] = [];

		for (const child of stat.children ?? []) {
			if (child.isDirectory) {
				const directoryName = basenameOrAuthority(child.resource);
				if (CODEBOARD_IGNORED_DIRECTORY_NAMES.has(directoryName)) {
					continue;
				}

				if (!(await this.hasSupportedFiles(child.resource))) {
					continue;
				}

				entries.push(this.toTreeItem(child, parent.rootUri, false));
				continue;
			}

			if (child.isFile && CODEBOARD_CODE_FILE_EXTENSIONS.has(extUriBiasedIgnorePathCase.extname(child.resource).toLowerCase())) {
				entries.push(this.toTreeItem(child, parent.rootUri, false));
			}
		}

		return entries.sort((left, right) => {
			if (left.isDirectory !== right.isDirectory) {
				return left.isDirectory ? -1 : 1;
			}

			return left.name.localeCompare(right.name);
		});
	}

	private async computeHasSupportedFiles(resource: URI): Promise<boolean> {
		try {
			const stat = await this.fileService.resolve(resource);
			for (const child of stat.children ?? []) {
				if (child.isFile && CODEBOARD_CODE_FILE_EXTENSIONS.has(extUriBiasedIgnorePathCase.extname(child.resource).toLowerCase())) {
					return true;
				}

				if (child.isDirectory) {
					const directoryName = basenameOrAuthority(child.resource);
					if (CODEBOARD_IGNORED_DIRECTORY_NAMES.has(directoryName)) {
						continue;
					}

					if (await this.hasSupportedFiles(child.resource)) {
						return true;
					}
				}
			}
		} catch {
			return false;
		}

		return false;
	}

	private toTreeItem(stat: IFileStat, rootUri: URI, isRoot: boolean): ICodeBoardWorkspaceTreeItem {
		return {
			name: stat.name,
			label: isRoot ? stat.name : (extUriBiasedIgnorePathCase.relativePath(rootUri, stat.resource) ?? stat.name),
			resource: stat.resource,
			isDirectory: stat.isDirectory,
			isRoot,
			rootUri,
		};
	}
}

interface ICodeBoardWorkspaceTreeTemplate {
	readonly label: IResourceLabel;
	readonly templateDisposables: DisposableStore;
}

class CodeBoardWorkspaceTreeRenderer implements ICompressibleTreeRenderer<ICodeBoardWorkspaceTreeItem, void, ICodeBoardWorkspaceTreeTemplate> {
	static readonly TEMPLATE_ID = 'codeboardWorkspaceTreeItem';
	readonly templateId = CodeBoardWorkspaceTreeRenderer.TEMPLATE_ID;

	constructor(
		private readonly labels: ResourceLabels,
		@ILabelService private readonly labelService: ILabelService,
	) { }

	renderTemplate(container: HTMLElement): ICodeBoardWorkspaceTreeTemplate {
		const templateDisposables = new DisposableStore();
		const label = templateDisposables.add(this.labels.create(container, { supportHighlights: true, supportIcons: true }));
		return { label, templateDisposables };
	}

	renderElement(node: ITreeNode<ICodeBoardWorkspaceTreeItem, void>, _index: number, templateData: ICodeBoardWorkspaceTreeTemplate): void {
		const element = node.element;
		templateData.label.element.style.display = 'flex';
		templateData.label.setFile(element.resource, {
			fileKind: element.isRoot ? FileKind.ROOT_FOLDER : (element.isDirectory ? FileKind.FOLDER : FileKind.FILE),
			hidePath: true,
		});
	}

	renderCompressedElements(node: ITreeNode<ICompressedTreeNode<ICodeBoardWorkspaceTreeItem>, void>, _index: number, templateData: ICodeBoardWorkspaceTreeTemplate): void {
		const compressed = node.element;
		const lastElement = compressed.elements[compressed.elements.length - 1];
		templateData.label.element.style.display = 'flex';
		templateData.label.setResource(
			{
				resource: lastElement.resource,
				name: compressed.elements.map(element => element.name),
			},
			{
				fileKind: lastElement.isRoot ? FileKind.ROOT_FOLDER : (lastElement.isDirectory ? FileKind.FOLDER : FileKind.FILE),
				separator: this.labelService.getSeparator(lastElement.resource.scheme),
			},
		);
	}

	disposeTemplate(templateData: ICodeBoardWorkspaceTreeTemplate): void {
		templateData.templateDisposables.dispose();
	}
}

class CodeBoardWorkspaceTreeCompressionDelegate {
	isIncompressible(element: ICodeBoardWorkspaceTreeItem): boolean {
		return !element.isDirectory || element.isRoot;
	}
}

class CodeBoardWorkspaceTreeDelegate implements IListVirtualDelegate<ICodeBoardWorkspaceTreeItem> {
	getHeight(): number {
		return 22;
	}

	getTemplateId(): string {
		return CodeBoardWorkspaceTreeRenderer.TEMPLATE_ID;
	}
}

class CodeBoardView extends ViewPane {
	private nodeButtonElement: HTMLButtonElement | undefined;
	private nodeDropdownElement: HTMLElement | undefined;
	private nodeDropdownStatusElement: HTMLElement | undefined;
	private nodeTreeContainerElement: HTMLElement | undefined;
	private nodeTreeRoots: ICodeBoardWorkspaceTreeItem[] | undefined;
	private nodePickerOpen = false;
	private nodePickerLoading = false;
	private nodePickerError = false;
	private readonly nodeTreeDisposables = this._register(new DisposableStore());
	private nodeTree: WorkbenchCompressibleAsyncDataTree<ICodeBoardWorkspaceTreeItem[], ICodeBoardWorkspaceTreeItem> | undefined;

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService protected override readonly instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IEditorService private readonly editorService: IEditorService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);

		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => this.resetNodePickerState()));
		this._register(this.workspaceContextService.onDidChangeWorkbenchState(() => this.resetNodePickerState()));
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

		const nodeActionGroup = document.createElement('div');
		nodeActionGroup.className = 'codeboard-sidebar-action-group';

		const nodeButton = this.createCreationButton(
			nls.localize('codeboardCreateNodeTitle', "Node"),
			nls.localize('codeboardCreateNodeDescription', "Pick a project file to start a code node"),
			() => this.toggleNodePicker()
		);
		this.nodeButtonElement = nodeButton;
		nodeActionGroup.appendChild(nodeButton);

		const nodeDropdown = document.createElement('div');
		nodeDropdown.className = 'codeboard-sidebar-dropdown hidden';
		this.nodeDropdownElement = nodeDropdown;

		const nodeDropdownStatus = document.createElement('div');
		nodeDropdownStatus.className = 'codeboard-sidebar-dropdown-status hidden';
		this.nodeDropdownStatusElement = nodeDropdownStatus;
		nodeDropdown.appendChild(nodeDropdownStatus);

		const nodeTreeContainer = document.createElement('div');
		nodeTreeContainer.className = 'codeboard-sidebar-tree-container hidden';
		this.nodeTreeContainerElement = nodeTreeContainer;
		nodeDropdown.appendChild(nodeTreeContainer);

		nodeActionGroup.appendChild(nodeDropdown);
		actions.appendChild(nodeActionGroup);

		actions.appendChild(this.createCreationButton(
			nls.localize('codeboardCreateControlsTitle', "Controls"),
			nls.localize('codeboardCreateControlsDescription', "Placeholder control panel"),
			() => this.createControlsPlaceholder()
		));

		const footer = document.createElement('div');
		footer.className = 'codeboard-sidebar-footer';
		footer.textContent = nls.localize('codeboardSidebarFooter', "Board-native items like text, notes, and graphs stay on the canvas toolbar.");

		section.appendChild(heading);
		section.appendChild(description);
		section.appendChild(actions);
		section.appendChild(footer);
		container.appendChild(section);

		this.renderNodePicker();
	}

	private createCreationButton(title: string, description: string, onClick: () => void | Promise<void>): HTMLButtonElement {
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
		button.addEventListener('click', () => {
			void onClick();
		});

		return button;
	}

	private resetNodePickerState(): void {
		this.nodeTreeRoots = undefined;
		this.nodePickerError = false;
		this.nodePickerLoading = false;
		this.nodeTreeDisposables.clear();
		this.nodeTree = undefined;
		if (this.nodePickerOpen) {
			void this.loadNodeTreeRoots();
			return;
		}

		this.renderNodePicker();
	}

	private async toggleNodePicker(): Promise<void> {
		this.nodePickerOpen = !this.nodePickerOpen;
		this.renderNodePicker();

		if (this.nodePickerOpen && !this.nodeTreeRoots && !this.nodePickerLoading) {
			await this.loadNodeTreeRoots();
		}
	}

	private async loadNodeTreeRoots(): Promise<void> {
		this.nodePickerLoading = true;
		this.nodePickerError = false;
		this.renderNodePicker();

		try {
			this.nodeTreeRoots = await this.resolveWorkspaceTreeRoots();
		} catch {
			this.nodeTreeRoots = [];
			this.nodePickerError = true;
		} finally {
			this.nodePickerLoading = false;
			this.renderNodePicker();
		}
	}

	private renderNodePicker(): void {
		if (!this.nodeDropdownElement || !this.nodeDropdownStatusElement || !this.nodeTreeContainerElement) {
			return;
		}

		this.nodeButtonElement?.classList.toggle('active', this.nodePickerOpen);
		this.nodeButtonElement?.setAttribute('aria-expanded', String(this.nodePickerOpen));
		this.nodeDropdownElement.classList.toggle('hidden', !this.nodePickerOpen);
		this.nodeDropdownStatusElement.classList.add('hidden');
		this.nodeTreeContainerElement.classList.add('hidden');
		this.nodeDropdownStatusElement.textContent = '';

		if (!this.nodePickerOpen) {
			return;
		}

		if (this.nodePickerLoading) {
			this.showNodePickerStatus(nls.localize('codeboardNodePickerLoading', "Loading workspace code files..."));
			return;
		}

		if (this.nodePickerError) {
			this.showNodePickerStatus(nls.localize('codeboardNodePickerError', "CodeBoard could not read the current workspace files."));
			return;
		}

		if (!this.hasWorkspaceFolders()) {
			this.showNodePickerStatus(nls.localize('codeboardNodePickerEmptyWorkspace', "Open a folder or workspace to choose a source file."));
			return;
		}

		if (!this.nodeTreeRoots?.length) {
			this.showNodePickerStatus(nls.localize('codeboardNodePickerNoFiles', "No supported code files were found in this workspace."));
			return;
		}

		this.nodeTreeContainerElement.classList.remove('hidden');
		this.ensureNodePickerTree();
		void this.nodeTree?.setInput(this.nodeTreeRoots);
	}

	private showNodePickerStatus(message: string): void {
		if (!this.nodeDropdownStatusElement) {
			return;
		}

		this.nodeDropdownStatusElement.textContent = message;
		this.nodeDropdownStatusElement.classList.remove('hidden');
	}

	private hasWorkspaceFolders(): boolean {
		return this.workspaceContextService.getWorkbenchState() !== WorkbenchState.EMPTY && this.workspaceContextService.getWorkspace().folders.length > 0;
	}

	private async createNodeFromWorkspaceFile(entry: ICodeBoardWorkspaceFileEntry): Promise<void> {
		await this.editorService.openEditor(CodeBoardEditorInput.instance, {
			pinned: true,
			revealIfOpened: true,
		});

		CodeBoardEditor.getActiveInstance()?.createWorkspaceNodeFromFile({
			label: entry.label,
			resource: entry.resource,
		});

		this.nodePickerOpen = false;
		this.renderNodePicker();
	}

	private ensureNodePickerTree(): void {
		if (this.nodeTree || !this.nodeTreeContainerElement) {
			return;
		}

		this.nodeTreeDisposables.add(createFileIconThemableTreeContainerScope(this.nodeTreeContainerElement, this.themeService));

		const resourceLabels = this.nodeTreeDisposables.add(this.instantiationService.createInstance(ResourceLabels, { onDidChangeVisibility: this.onDidChangeBodyVisibility }));
		const dataSource = this.instantiationService.createInstance(CodeBoardWorkspaceTreeDataSource);

		this.nodeTree = this.nodeTreeDisposables.add(this.instantiationService.createInstance(
			WorkbenchCompressibleAsyncDataTree<ICodeBoardWorkspaceTreeItem[], ICodeBoardWorkspaceTreeItem>,
			'CodeBoardWorkspaceFiles',
			this.nodeTreeContainerElement,
			new CodeBoardWorkspaceTreeDelegate(),
			new CodeBoardWorkspaceTreeCompressionDelegate(),
			[this.instantiationService.createInstance(CodeBoardWorkspaceTreeRenderer, resourceLabels)],
			dataSource,
			{
				accessibilityProvider: {
					getAriaLabel: (element: ICodeBoardWorkspaceTreeItem) => element.name,
					getWidgetAriaLabel: () => nls.localize('codeboardWorkspaceFilesTree', "CodeBoard workspace files"),
				},
				identityProvider: {
					getId: (element: ICodeBoardWorkspaceTreeItem) => element.resource.toString(),
				},
				compressionEnabled: true,
				multipleSelectionSupport: false,
				collapseByDefault: (_element: ICodeBoardWorkspaceTreeItem) => true,
				showNotFoundMessage: false,
			},
		));

		this.nodeTreeDisposables.add(this.nodeTree.onDidOpen(event => {
			if (!event.element || event.element.isDirectory) {
				return;
			}

			void this.createNodeFromWorkspaceFile(event.element);
		}));
	}

	private async createControlsPlaceholder(): Promise<void> {
		await this.editorService.openEditor(CodeBoardEditorInput.instance, {
			pinned: true,
			revealIfOpened: true,
		});

		CodeBoardEditor.getActiveInstance()?.createWorkspaceObject('controls');
	}

	private async resolveWorkspaceTreeRoots(): Promise<ICodeBoardWorkspaceTreeItem[]> {
		if (!this.hasWorkspaceFolders()) {
			return [];
		}

		const dataSource = this.instantiationService.createInstance(CodeBoardWorkspaceTreeDataSource);
		const workspace = this.workspaceContextService.getWorkspace();
		const roots: ICodeBoardWorkspaceTreeItem[] = [];

		for (const folder of workspace.folders) {
			if (!(await dataSource.hasSupportedFiles(folder.uri))) {
				continue;
			}

			roots.push({
				name: folder.name,
				label: folder.name,
				resource: folder.uri,
				isDirectory: true,
				isRoot: true,
				rootUri: folder.uri,
			});
		}

		return roots;
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
