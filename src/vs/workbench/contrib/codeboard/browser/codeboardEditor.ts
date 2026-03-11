/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/codeboardEditor.css';
import { addDisposableListener, Dimension, EventType } from '../../../../base/browser/dom.js';
import { StandardMouseEvent } from '../../../../base/browser/mouseEvent.js';
import { Action } from '../../../../base/common/actions.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { clamp } from '../../../../base/common/numbers.js';
import { basenameOrAuthority } from '../../../../base/common/resources.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';

interface ICodeBoardToolbarAction {
	readonly icon: ThemeIcon;
	readonly label: string;
	readonly onClick?: () => void;
	readonly disabled?: boolean;
}

type CodeBoardItemKind = 'text' | 'note' | 'graph' | 'node' | 'controls';

interface ICodeBoardNodeSource {
	readonly label: string;
	readonly resource: URI;
}

interface ICodeBoardCopiedItem {
	readonly kind: CodeBoardItemKind;
	readonly width: number;
	readonly height: number;
	readonly textValue?: string;
	readonly noteText?: string;
	readonly nodeLabel?: string;
	readonly nodeResource?: string;
}

export class CodeBoardEditor extends EditorPane {

	static readonly ID = 'workbench.editor.codeboard';
	private static activeInstance: CodeBoardEditor | undefined;
	private static readonly baseSurfaceWidth = 3200;
	private static readonly baseSurfaceHeight = 2400;
	private static readonly minZoomLevel = 0.5;
	private static readonly maxZoomLevel = 2;
	private static readonly zoomStep = 0.1;
	private static readonly minTextWidth = 140;
	private static readonly maxTextWidth = 960;
	private static readonly minTextHeight = 44;
	private static readonly maxTextHeight = 320;

	private viewportElement: HTMLElement | undefined;
	private canvasElement: HTMLElement | undefined;
	private surfaceElement: HTMLElement | undefined;
	private itemsLayerElement: HTMLElement | undefined;
	private zoomLabelElement: HTMLElement | undefined;
	private zoomInButton: HTMLButtonElement | undefined;
	private zoomOutButton: HTMLButtonElement | undefined;
	private hasCenteredInitialViewport = false;
	private zoomLevel = 1;
	private createdItemCount = 0;
	private readonly itemStores = new Map<HTMLElement, DisposableStore>();
	private readonly textFields = new Map<HTMLElement, HTMLTextAreaElement>();
	private readonly noteFields = new Map<HTMLElement, HTMLTextAreaElement>();
	private selectedItemElement: HTMLElement | undefined;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IClipboardService private readonly clipboardService: IClipboardService,
	) {
		super(CodeBoardEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected override createEditor(parent: HTMLElement): void {
		parent.classList.add('codeboard-editor-pane');

		const root = document.createElement('div');
		root.className = 'codeboard-editor';

		const viewport = document.createElement('div');
		viewport.className = 'codeboard-editor-viewport';
		viewport.tabIndex = 0;

		const canvas = document.createElement('div');
		canvas.className = 'codeboard-editor-canvas';

		const surface = document.createElement('div');
		surface.className = 'codeboard-editor-surface';

		const itemsLayer = document.createElement('div');
		itemsLayer.className = 'codeboard-board-items';

		surface.appendChild(itemsLayer);
		canvas.appendChild(surface);
		viewport.appendChild(canvas);
		root.appendChild(viewport);
		root.appendChild(this.createTitlePill());
		root.appendChild(this.createToolbarPill());
		root.appendChild(this.createZoomPill());
		root.appendChild(this.createLayoutPill());
		parent.appendChild(root);

		this.viewportElement = viewport;
		this.canvasElement = canvas;
		this.surfaceElement = surface;
		this.itemsLayerElement = itemsLayer;
		CodeBoardEditor.activeInstance = this;
		this.updateZoomPresentation();

		this._register(addDisposableListener(viewport, EventType.MOUSE_DOWN, event => {
			const target = event.target as HTMLElement | null;
			if (!target?.closest('.codeboard-board-item')) {
				this.setSelectedItem(undefined);
			}
		}));
	}

	private createTitlePill(): HTMLElement {
		const pill = document.createElement('div');
		pill.className = 'codeboard-floating-pill codeboard-title-pill';

		const label = document.createElement('span');
		label.className = 'codeboard-title-label';
		label.textContent = localize('codeboardProjectBoardTitle', "Project Board");

		pill.appendChild(label);

		return pill;
	}

	private createToolbarPill(): HTMLElement {
		const pill = document.createElement('div');
		pill.className = 'codeboard-floating-pill codeboard-toolbar-pill';

		[
			{
				icon: Codicon.textSize,
				label: localize('codeboardCreateTextBlock', "Create Text Block"),
				onClick: () => this.createBoardObject('text'),
			},
			{
				icon: Codicon.note,
				label: localize('codeboardCreateNoteBlock', "Create Note Block"),
				onClick: () => this.createBoardObject('note'),
			},
			{
				icon: Codicon.graphLine,
				label: localize('codeboardCreateGraphBlock', "Create Graph Block"),
				onClick: () => this.createBoardObject('graph'),
			},
			{
				icon: Codicon.table,
				label: localize('codeboardTableToolComingSoon', "Table Tool Coming Soon"),
				disabled: true,
			},
			{
				icon: Codicon.attach,
				label: localize('codeboardAttachToolComingSoon', "Attach Tool Coming Soon"),
				disabled: true,
			},
		].forEach(action => pill.appendChild(this.createIconButton(action)));

		return pill;
	}

	private createZoomPill(): HTMLElement {
		const pill = document.createElement('div');
		pill.className = 'codeboard-floating-pill codeboard-zoom-pill';

		const zoomOut = document.createElement('button');
		zoomOut.className = 'codeboard-zoom-button';
		zoomOut.type = 'button';
		zoomOut.setAttribute('aria-label', localize('codeboardZoomOut', "Zoom Out"));
		zoomOut.textContent = '-';
		this._register(addDisposableListener(zoomOut, EventType.CLICK, () => this.changeZoom(-CodeBoardEditor.zoomStep)));

		const zoomLabel = document.createElement('span');
		zoomLabel.className = 'codeboard-zoom-label';
		this.zoomLabelElement = zoomLabel;

		const zoomIn = document.createElement('button');
		zoomIn.className = 'codeboard-zoom-button';
		zoomIn.type = 'button';
		zoomIn.setAttribute('aria-label', localize('codeboardZoomIn', "Zoom In"));
		zoomIn.textContent = '+';
		this._register(addDisposableListener(zoomIn, EventType.CLICK, () => this.changeZoom(CodeBoardEditor.zoomStep)));

		this.zoomOutButton = zoomOut;
		this.zoomInButton = zoomIn;

		pill.appendChild(zoomOut);
		pill.appendChild(zoomLabel);
		pill.appendChild(zoomIn);

		return pill;
	}

	private createLayoutPill(): HTMLElement {
		const pill = document.createElement('div');
		pill.className = 'codeboard-floating-pill codeboard-layout-pill';
		pill.appendChild(this.createIconButton({
			icon: Codicon.layout,
			label: localize('codeboardLayoutControlsComingSoon', "Layout Controls Coming Soon"),
			disabled: true,
		}));
		pill.appendChild(this.createIconButton({
			icon: Codicon.map,
			label: localize('codeboardMiniMapComingSoon', "Mini Map Coming Soon"),
			disabled: true,
		}));

		return pill;
	}

	private createIconButton(action: ICodeBoardToolbarAction): HTMLButtonElement {
		const button = document.createElement('button');
		button.className = 'codeboard-icon-button';
		button.type = 'button';
		button.setAttribute('aria-label', action.label);
		if (action.disabled) {
			button.disabled = true;
		} else if (action.onClick) {
			this._register(addDisposableListener(button, EventType.CLICK, () => action.onClick?.()));
		}

		const iconElement = document.createElement('span');
		iconElement.classList.add(...ThemeIcon.asClassNameArray(action.icon));
		button.appendChild(iconElement);

		return button;
	}

	private changeZoom(delta: number): void {
		if (!this.viewportElement) {
			return;
		}

		const previousZoomLevel = this.zoomLevel;
		const nextZoomLevel = clamp(Number((this.zoomLevel + delta).toFixed(2)), CodeBoardEditor.minZoomLevel, CodeBoardEditor.maxZoomLevel);
		if (nextZoomLevel === previousZoomLevel) {
			return;
		}

		const centerX = (this.viewportElement.scrollLeft + (this.viewportElement.clientWidth / 2)) / previousZoomLevel;
		const centerY = (this.viewportElement.scrollTop + (this.viewportElement.clientHeight / 2)) / previousZoomLevel;

		this.zoomLevel = nextZoomLevel;
		this.updateZoomPresentation();

		this.viewportElement.scrollLeft = Math.max(0, Math.round((centerX * this.zoomLevel) - (this.viewportElement.clientWidth / 2)));
		this.viewportElement.scrollTop = Math.max(0, Math.round((centerY * this.zoomLevel) - (this.viewportElement.clientHeight / 2)));
	}

	private updateZoomPresentation(): void {
		if (this.canvasElement) {
			this.canvasElement.style.width = `${CodeBoardEditor.baseSurfaceWidth * this.zoomLevel}px`;
			this.canvasElement.style.height = `${CodeBoardEditor.baseSurfaceHeight * this.zoomLevel}px`;
		}

		if (this.surfaceElement) {
			this.surfaceElement.style.transform = `scale(${this.zoomLevel})`;
		}

		if (this.zoomLabelElement) {
			this.zoomLabelElement.textContent = localize('codeboardZoomPercentage', "{0}%", Math.round(this.zoomLevel * 100));
		}

		if (this.zoomOutButton) {
			this.zoomOutButton.disabled = this.zoomLevel <= CodeBoardEditor.minZoomLevel;
		}

		if (this.zoomInButton) {
			this.zoomInButton.disabled = this.zoomLevel >= CodeBoardEditor.maxZoomLevel;
		}
	}

	static getActiveInstance(): CodeBoardEditor | undefined {
		return CodeBoardEditor.activeInstance;
	}

	public createBoardObject(kind: CodeBoardItemKind): void {
		switch (kind) {
			case 'text':
				this.addTextBlock();
				break;
			case 'note':
				this.addNoteBlock();
				break;
			case 'graph':
				this.addGraphBlock();
				break;
			default:
				break;
		}
	}

	public createWorkspaceObject(kind: 'controls'): void {
		switch (kind) {
			case 'controls':
				this.addControlsBlock();
				break;
		}
	}

	public createWorkspaceNodeFromFile(source: ICodeBoardNodeSource): void {
		const item = this.createBoardNodeBlock(undefined, source);
		this.setSelectedItem(item);
	}

	private addTextBlock(): void {
		const item = this.createBoardTextBlock();
		this.setSelectedItem(item);
	}

	private createBoardTextBlock(
		position = this.getSpawnPosition(232, 54),
		textValue = localize('codeboardTextDefaultValue', "Type to enter text"),
		size = { width: 232, height: 54 },
	): HTMLElement {
		const item = this.createBoardItem('text', size.width, size.height, undefined, position);
		item.classList.add('codeboard-board-item-text');

		const input = document.createElement('textarea');
		input.className = 'codeboard-text-input';
		input.spellcheck = false;
		input.value = textValue;
		item.appendChild(input);
		this.textFields.set(item, input);

		const store = this.createItemStore(item);
		this.registerSelectableItem(item, store);
		this.registerDraggableBoardItem(item, store, target => !this.isEditableTextTarget(target) && !this.isTextResizeHandle(target));
		this.registerContextMenu(item, store);
		this.registerTextFieldContext(item, input, store);

		for (const [handleClassName, edge] of [
			['codeboard-text-handle-left', 'left'],
			['codeboard-text-handle-right', 'right'],
			['codeboard-text-handle-corner', 'corner'],
		] as const) {
			const handle = document.createElement('span');
			handle.className = `codeboard-text-selection-handle ${handleClassName}`;
			handle.dataset.resizeEdge = edge;
			item.appendChild(handle);
			this.registerTextResizeHandle(item, handle, edge, store);
		}

		this.focusBoardField(input);
		return item;
	}

	private addNoteBlock(): void {
		const item = this.createBoardNoteBlock();
		this.setSelectedItem(item);
	}

	private createBoardNoteBlock(position = this.getSpawnPosition(300, 224), noteText = localize('codeboardNoteDefaultValue', "Capture an idea, a prompt, or a loose plan.")): HTMLElement {
		const item = this.createBoardItem('note', 300, 224, localize('codeboardNoteBadge', "Note"), position);
		item.classList.add('codeboard-board-item-note');

		const input = document.createElement('textarea');
		input.className = 'codeboard-note-input';
		input.spellcheck = false;
		input.value = noteText;
		item.appendChild(input);
		this.noteFields.set(item, input);

		const store = this.createItemStore(item);
		this.registerSelectableItem(item, store);
		this.registerDraggableBoardItem(item, store, target => !target.closest('.codeboard-note-input'));
		this.registerContextMenu(item, store);
		this.registerTextFieldContext(item, input, store);

		this.focusBoardField(input);
		return item;
	}

	private addGraphBlock(): void {
		const item = this.createBoardGraphBlock();
		this.setSelectedItem(item);
	}

	private addControlsBlock(): void {
		const item = this.createBoardControlsBlock();
		this.setSelectedItem(item);
	}

	private createBoardGraphBlock(position = this.getSpawnPosition(360, 240)): HTMLElement {
		const item = this.createBoardItem('graph', 360, 240, localize('codeboardGraphBadge', "Graph"), position);
		item.classList.add('codeboard-board-item-graph');

		const title = document.createElement('div');
		title.className = 'codeboard-graph-title';
		title.textContent = localize('codeboardGraphTitle', "Variable Relationship");

		const subtitle = document.createElement('div');
		subtitle.className = 'codeboard-graph-subtitle';
		subtitle.textContent = localize('codeboardGraphSubtitle', "Bind x/y values later from traced runtime data.");

		const plot = document.createElement('div');
		plot.className = 'codeboard-graph-plot';
		plot.appendChild(this.createGraphPreview());

		const axes = document.createElement('div');
		axes.className = 'codeboard-graph-axes';

		const xAxis = document.createElement('span');
		xAxis.textContent = localize('codeboardGraphXAxis', "x: time");

		const yAxis = document.createElement('span');
		yAxis.textContent = localize('codeboardGraphYAxis', "y: value");

		axes.appendChild(xAxis);
		axes.appendChild(yAxis);
		item.appendChild(title);
		item.appendChild(subtitle);
		item.appendChild(plot);
		item.appendChild(axes);

		const store = this.createItemStore(item);
		this.registerSelectableItem(item, store);
		this.registerDraggableBoardItem(item, store);
		this.registerContextMenu(item, store);

		return item;
	}

	private createBoardNodeBlock(position = this.getSpawnPosition(320, 188), source: ICodeBoardNodeSource): HTMLElement {
		const item = this.createBoardItem('node', 320, 188, localize('codeboardNodeBadge', "Node"), position);
		item.classList.add('codeboard-board-item-node');
		item.dataset.sourceLabel = source.label;
		item.dataset.sourceResource = source.resource.toString();

		const title = document.createElement('div');
		title.className = 'codeboard-node-title';
		title.textContent = basenameOrAuthority(source.resource);

		const subtitle = document.createElement('div');
		subtitle.className = 'codeboard-node-subtitle';
		subtitle.textContent = source.label;

		const caption = document.createElement('div');
		caption.className = 'codeboard-node-caption';
		caption.textContent = localize('codeboardNodeCaption', "Mock code node linked to a workspace file.");

		item.appendChild(title);
		item.appendChild(subtitle);
		item.appendChild(caption);

		const store = this.createItemStore(item);
		this.registerSelectableItem(item, store);
		this.registerDraggableBoardItem(item, store);
		this.registerContextMenu(item, store);

		return item;
	}

	private createBoardControlsBlock(position = this.getSpawnPosition(300, 220)): HTMLElement {
		const item = this.createBoardItem('controls', 300, 184, localize('codeboardControlsBadge', "Controls"), position);
		item.classList.add('codeboard-board-item-controls');

		const title = document.createElement('div');
		title.className = 'codeboard-controls-title';
		title.textContent = localize('codeboardControlsTitle', "Controls Placeholder");

		const subtitle = document.createElement('div');
		subtitle.className = 'codeboard-controls-subtitle';
		subtitle.textContent = localize('codeboardControlsSubtitle', "Parameter widgets will live here after nodes start exposing fields and values.");

		const placeholder = document.createElement('div');
		placeholder.className = 'codeboard-controls-placeholder';
		placeholder.textContent = localize('codeboardControlsPlaceholder', "Placeholder panel");

		item.appendChild(title);
		item.appendChild(subtitle);
		item.appendChild(placeholder);

		const store = this.createItemStore(item);
		this.registerSelectableItem(item, store);
		this.registerDraggableBoardItem(item, store);
		this.registerContextMenu(item, store);

		return item;
	}

	private createBoardItem(kind: CodeBoardItemKind, width: number, height: number, badgeText: string | undefined, position = this.getSpawnPosition(width, height)): HTMLElement {
		const item = document.createElement('div');
		item.className = 'codeboard-board-item';
		item.style.width = `${width}px`;
		item.style.height = `${height}px`;
		item.style.left = `${position.x}px`;
		item.style.top = `${position.y}px`;

		item.dataset.kind = kind;
		if (badgeText) {
			const badge = document.createElement('div');
			badge.className = 'codeboard-board-item-badge';
			badge.textContent = badgeText;
			item.appendChild(badge);
		}
		this.itemsLayerElement?.appendChild(item);
		this.createdItemCount++;

		return item;
	}

	private getSpawnPosition(width: number, height: number): { x: number; y: number } {
		const viewportCenterX = this.viewportElement ? (this.viewportElement.scrollLeft + (this.viewportElement.clientWidth / 2)) / this.zoomLevel : CodeBoardEditor.baseSurfaceWidth / 2;
		const viewportCenterY = this.viewportElement ? (this.viewportElement.scrollTop + (this.viewportElement.clientHeight / 2)) / this.zoomLevel : CodeBoardEditor.baseSurfaceHeight / 2;
		const cascadeOffset = (this.createdItemCount % 6) * 30;

		return {
			x: clamp(Math.round(viewportCenterX - (width / 2) + cascadeOffset), 48, CodeBoardEditor.baseSurfaceWidth - width - 48),
			y: clamp(Math.round(viewportCenterY - (height / 2) + cascadeOffset), 48, CodeBoardEditor.baseSurfaceHeight - height - 48),
		};
	}

	private createGraphPreview(): SVGElement {
		const namespace = 'http://www.w3.org/2000/svg';
		const svg = document.createElementNS(namespace, 'svg');
		svg.setAttribute('class', 'codeboard-graph-preview');
		svg.setAttribute('viewBox', '0 0 320 140');
		svg.setAttribute('fill', 'none');

		const area = document.createElementNS(namespace, 'path');
		area.setAttribute('class', 'codeboard-graph-area');
		area.setAttribute('d', 'M20 109 C55 97 85 55 122 62 C158 68 184 110 214 96 C246 82 268 36 300 28 L300 140 L20 140 Z');

		const line = document.createElementNS(namespace, 'path');
		line.setAttribute('class', 'codeboard-graph-line');
		line.setAttribute('d', 'M20 109 C55 97 85 55 122 62 C158 68 184 110 214 96 C246 82 268 36 300 28');

		const points = [
			{ cx: '20', cy: '109' },
			{ cx: '122', cy: '62' },
			{ cx: '214', cy: '96' },
			{ cx: '300', cy: '28' },
		];

		svg.appendChild(area);
		svg.appendChild(line);

		for (const point of points) {
			const circle = document.createElementNS(namespace, 'circle');
			circle.setAttribute('class', 'codeboard-graph-point');
			circle.setAttribute('r', '4');
			circle.setAttribute('cx', point.cx);
			circle.setAttribute('cy', point.cy);
			svg.appendChild(circle);
		}

		return svg;
	}

	private createItemStore(item: HTMLElement): DisposableStore {
		const existingStore = this.itemStores.get(item);
		existingStore?.dispose();

		const store = new DisposableStore();
		this.itemStores.set(item, store);
		return store;
	}

	private registerSelectableItem(item: HTMLElement, store: DisposableStore): void {
		store.add(addDisposableListener(item, EventType.CLICK, () => this.setSelectedItem(item)));
	}

	private registerTextFieldContext(item: HTMLElement, field: HTMLTextAreaElement, store: DisposableStore): void {
		store.add(addDisposableListener(field, EventType.FOCUS, () => this.setSelectedItem(item)));
		store.add(addDisposableListener(field, EventType.CONTEXT_MENU, () => this.setSelectedItem(item)));
	}

	private registerDraggableBoardItem(item: HTMLElement, store: DisposableStore, canStartDrag: (target: HTMLElement) => boolean = () => true): void {
		store.add(addDisposableListener(item, EventType.MOUSE_DOWN, event => {
			if (event.button !== 0) {
				return;
			}

			const target = event.target as HTMLElement | null;
			if (!target || !canStartDrag(target)) {
				return;
			}

			event.preventDefault();
			this.setSelectedItem(item);

			const startX = event.clientX;
			const startY = event.clientY;
			const startLeft = Number.parseFloat(item.style.left || '0');
			const startTop = Number.parseFloat(item.style.top || '0');
			const width = item.offsetWidth;
			const height = item.offsetHeight;
			const dragStore = new DisposableStore();
			let isDragging = false;

			const stopDragging = () => {
				item.classList.remove('codeboard-board-item-dragging');
				dragStore.dispose();
			};

			dragStore.add(addDisposableListener(this.window.document, EventType.MOUSE_MOVE, moveEvent => {
				const deltaX = (moveEvent.clientX - startX) / this.zoomLevel;
				const deltaY = (moveEvent.clientY - startY) / this.zoomLevel;

				if (!isDragging && (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1)) {
					isDragging = true;
					item.classList.add('codeboard-board-item-dragging');
				}

				item.style.left = `${clamp(Math.round(startLeft + deltaX), 48, CodeBoardEditor.baseSurfaceWidth - width - 48)}px`;
				item.style.top = `${clamp(Math.round(startTop + deltaY), 48, CodeBoardEditor.baseSurfaceHeight - height - 48)}px`;
			}));
			dragStore.add(addDisposableListener(this.window.document, EventType.MOUSE_UP, () => stopDragging()));
		}));
	}

	private registerTextResizeHandle(item: HTMLElement, handle: HTMLElement, edge: 'left' | 'right' | 'corner', store: DisposableStore): void {
		store.add(addDisposableListener(handle, EventType.MOUSE_DOWN, event => {
			if (event.button !== 0) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			this.setSelectedItem(item);

			const startX = event.clientX;
			const startY = event.clientY;
			const startLeft = Number.parseFloat(item.style.left || '0');
			const startTop = Number.parseFloat(item.style.top || '0');
			const startWidth = item.offsetWidth;
			const startHeight = item.offsetHeight;
			const resizeStore = new DisposableStore();

			const stopResizing = () => {
				item.classList.remove('codeboard-board-item-resizing');
				resizeStore.dispose();
			};

			resizeStore.add(addDisposableListener(this.window.document, EventType.MOUSE_MOVE, moveEvent => {
				const deltaX = (moveEvent.clientX - startX) / this.zoomLevel;
				const deltaY = (moveEvent.clientY - startY) / this.zoomLevel;
				item.classList.add('codeboard-board-item-resizing');
				const maxWidth = Math.min(CodeBoardEditor.maxTextWidth, CodeBoardEditor.baseSurfaceWidth - startLeft - 24);
				const maxHeight = Math.min(CodeBoardEditor.maxTextHeight, CodeBoardEditor.baseSurfaceHeight - startTop - 24);

				if (edge === 'left') {
					const nextWidth = clamp(Math.round(startWidth - deltaX), CodeBoardEditor.minTextWidth, CodeBoardEditor.maxTextWidth);
					const consumedWidth = nextWidth - startWidth;
					item.style.width = `${nextWidth}px`;
					item.style.left = `${clamp(Math.round(startLeft - consumedWidth), 24, CodeBoardEditor.baseSurfaceWidth - nextWidth - 24)}px`;
					return;
				}

				const nextWidth = clamp(Math.round(startWidth + deltaX), CodeBoardEditor.minTextWidth, maxWidth);
				item.style.width = `${nextWidth}px`;

				if (edge === 'corner') {
					const nextHeight = clamp(Math.round(startHeight + deltaY), CodeBoardEditor.minTextHeight, maxHeight);
					item.style.height = `${nextHeight}px`;
				}
			}));
			resizeStore.add(addDisposableListener(this.window.document, EventType.MOUSE_UP, () => stopResizing()));
		}));
	}

	private registerContextMenu(item: HTMLElement, store: DisposableStore): void {
		store.add(addDisposableListener(item, EventType.CONTEXT_MENU, event => {
			const target = event.target as HTMLElement | null;
			if (target && this.isEditableTextTarget(target)) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			this.setSelectedItem(item);
			this.showItemContextMenu(item, event);
		}));
	}

	private isEditableTextTarget(target: HTMLElement): boolean {
		return !!target.closest('.codeboard-text-input, .codeboard-note-input');
	}

	private isTextResizeHandle(target: HTMLElement): boolean {
		return !!target.closest('.codeboard-text-selection-handle');
	}

	private showItemContextMenu(item: HTMLElement, event: MouseEvent): void {
		const actionsStore = new DisposableStore();
		const actions = [
			actionsStore.add(new Action('codeboard.copyItem', localize('codeboardCopyItemAction', "Copy"), undefined, true, async () => this.copyBoardItem(item))),
			actionsStore.add(new Action('codeboard.duplicateItem', localize('codeboardDuplicateItemAction', "Duplicate"), undefined, true, async () => this.duplicateBoardItem(item))),
			actionsStore.add(new Action('codeboard.deleteItem', localize('codeboardDeleteItemAction', "Delete"), undefined, true, async () => this.deleteBoardItem(item))),
		];

		this.contextMenuService.showContextMenu({
			getAnchor: () => new StandardMouseEvent(this.window, event),
			getActions: () => actions,
			onHide: () => actionsStore.dispose(),
		});
	}

	private async copyBoardItem(item: HTMLElement): Promise<void> {
		const copiedItem = this.captureCopiedItem(item);
		if (!copiedItem) {
			return;
		}

		const clipboardText = copiedItem.kind === 'text'
			? (copiedItem.textValue || localize('codeboardEmptyTextClipboard', "Text Block"))
			: copiedItem.kind === 'note'
				? (copiedItem.noteText || localize('codeboardEmptyNoteClipboard', "Note Block"))
				: copiedItem.kind === 'graph'
					? localize('codeboardGraphClipboard', "Graph Block")
					: copiedItem.kind === 'node'
						? (copiedItem.nodeLabel || localize('codeboardNodeClipboard', "Node Block"))
						: localize('codeboardControlsClipboard', "Controls Block");

		await this.clipboardService.writeText(clipboardText);
	}

	private async duplicateBoardItem(item: HTMLElement): Promise<void> {
		const copiedItem = this.captureCopiedItem(item);
		if (!copiedItem) {
			return;
		}

		const duplicatedPosition = this.getDuplicatedPosition(item);
		const duplicatedItem = copiedItem.kind === 'text'
			? this.createBoardTextBlock(duplicatedPosition, copiedItem.textValue, { width: copiedItem.width, height: copiedItem.height })
			: copiedItem.kind === 'note'
				? this.createBoardNoteBlock(duplicatedPosition, copiedItem.noteText)
				: copiedItem.kind === 'graph'
					? this.createBoardGraphBlock(duplicatedPosition)
					: copiedItem.kind === 'node'
						? this.createBoardNodeBlock(duplicatedPosition, {
							label: copiedItem.nodeLabel || localize('codeboardNodeDuplicateFallbackLabel', "Selected workspace file"),
							resource: copiedItem.nodeResource ? URI.parse(copiedItem.nodeResource) : URI.parse('untitled:codeboard-node'),
						})
						: this.createBoardControlsBlock(duplicatedPosition);

		this.setSelectedItem(duplicatedItem);
	}

	private async deleteBoardItem(item: HTMLElement): Promise<void> {
		this.removeBoardItem(item);
	}

	private captureCopiedItem(item: HTMLElement): ICodeBoardCopiedItem | undefined {
		if (item.dataset.kind === 'text') {
			return {
				kind: 'text',
				width: item.offsetWidth,
				height: item.offsetHeight,
				textValue: this.textFields.get(item)?.value || '',
			};
		}

		if (item.dataset.kind === 'note') {
			return {
				kind: 'note',
				width: item.offsetWidth,
				height: item.offsetHeight,
				noteText: this.noteFields.get(item)?.value || '',
			};
		}

		if (item.dataset.kind === 'graph') {
			return {
				kind: 'graph',
				width: item.offsetWidth,
				height: item.offsetHeight,
			};
		}

		if (item.dataset.kind === 'node') {
			return {
				kind: 'node',
				width: item.offsetWidth,
				height: item.offsetHeight,
				nodeLabel: item.dataset.sourceLabel,
				nodeResource: item.dataset.sourceResource,
			};
		}

		if (item.dataset.kind === 'controls') {
			return {
				kind: 'controls',
				width: item.offsetWidth,
				height: item.offsetHeight,
			};
		}

		return undefined;
	}

	private getDuplicatedPosition(item: HTMLElement): { x: number; y: number } {
		const left = Number.parseFloat(item.style.left || '0');
		const top = Number.parseFloat(item.style.top || '0');
		const width = item.offsetWidth;
		const height = item.offsetHeight;

		return {
			x: clamp(Math.round(left + 34), 48, CodeBoardEditor.baseSurfaceWidth - width - 48),
			y: clamp(Math.round(top + 34), 48, CodeBoardEditor.baseSurfaceHeight - height - 48),
		};
	}

	private removeBoardItem(item: HTMLElement): void {
		if (this.selectedItemElement === item) {
			this.selectedItemElement = undefined;
		}

		const store = this.itemStores.get(item);
		store?.dispose();
		this.itemStores.delete(item);
		this.textFields.delete(item);
		this.noteFields.delete(item);
		item.remove();
	}

	private setSelectedItem(item: HTMLElement | undefined): void {
		if (this.selectedItemElement === item) {
			return;
		}

		this.selectedItemElement?.classList.remove('codeboard-board-item-selected');
		this.selectedItemElement = item;
		this.selectedItemElement?.classList.add('codeboard-board-item-selected');
	}

	private focusBoardField(input: HTMLTextAreaElement): void {
		this.window.requestAnimationFrame(() => {
			input.focus();
			input.select();
		});
	}

	override focus(): void {
		this.viewportElement?.focus();
	}

	override layout(_dimension: Dimension): void {
		if (this.hasCenteredInitialViewport || !this.viewportElement || !this.canvasElement) {
			return;
		}

		const { clientWidth, clientHeight } = this.viewportElement;
		if (!clientWidth || !clientHeight) {
			return;
		}

		this.viewportElement.scrollLeft = Math.max(0, Math.round((this.canvasElement.scrollWidth - clientWidth) / 2));
		this.viewportElement.scrollTop = Math.max(0, Math.round((this.canvasElement.scrollHeight - clientHeight) / 2));
		this.hasCenteredInitialViewport = true;
	}

	override dispose(): void {
		for (const store of this.itemStores.values()) {
			store.dispose();
		}

		this.itemStores.clear();
		this.textFields.clear();
		this.noteFields.clear();
		this.selectedItemElement = undefined;
		if (CodeBoardEditor.activeInstance === this) {
			CodeBoardEditor.activeInstance = undefined;
		}

		super.dispose();
	}
}
