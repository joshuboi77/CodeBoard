/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/codeboardEditor.css';
import { Dimension } from '../../../../base/browser/dom.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';

export class CodeBoardEditor extends EditorPane {

	static readonly ID = 'workbench.editor.codeboard';

	private viewportElement: HTMLElement | undefined;
	private surfaceElement: HTMLElement | undefined;
	private hasCenteredInitialViewport = false;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
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

		const surface = document.createElement('div');
		surface.className = 'codeboard-editor-surface';

		viewport.appendChild(surface);
		root.appendChild(viewport);
		root.appendChild(this.createTitlePill());
		root.appendChild(this.createToolbarPill());
		root.appendChild(this.createZoomPill());
		root.appendChild(this.createLayoutPill());
		parent.appendChild(root);

		this.viewportElement = viewport;
		this.surfaceElement = surface;
	}

	private createTitlePill(): HTMLElement {
		const pill = document.createElement('div');
		pill.className = 'codeboard-floating-pill codeboard-title-pill';

		const label = document.createElement('span');
		label.className = 'codeboard-title-label';
		label.textContent = 'Project Board';

		pill.appendChild(label);

		return pill;
	}

	private createToolbarPill(): HTMLElement {
		const pill = document.createElement('div');
		pill.className = 'codeboard-floating-pill codeboard-toolbar-pill';

		[
			Codicon.textSize,
			Codicon.note,
			Codicon.symbolClass,
			Codicon.table,
			Codicon.attach
		].forEach(icon => pill.appendChild(this.createIconButton(icon)));

		return pill;
	}

	private createZoomPill(): HTMLElement {
		const pill = document.createElement('div');
		pill.className = 'codeboard-floating-pill codeboard-zoom-pill';

		const zoomOut = document.createElement('button');
		zoomOut.className = 'codeboard-zoom-button';
		zoomOut.textContent = '-';

		const zoomLabel = document.createElement('span');
		zoomLabel.className = 'codeboard-zoom-label';
		zoomLabel.textContent = '100%';

		const zoomIn = document.createElement('button');
		zoomIn.className = 'codeboard-zoom-button';
		zoomIn.textContent = '+';

		pill.appendChild(zoomOut);
		pill.appendChild(zoomLabel);
		pill.appendChild(zoomIn);

		return pill;
	}

	private createLayoutPill(): HTMLElement {
		const pill = document.createElement('div');
		pill.className = 'codeboard-floating-pill codeboard-layout-pill';
		pill.appendChild(this.createIconButton(Codicon.layout));
		pill.appendChild(this.createIconButton(Codicon.map));

		return pill;
	}

	private createIconButton(icon: ThemeIcon): HTMLElement {
		const button = document.createElement('button');
		button.className = 'codeboard-icon-button';
		button.ariaHidden = 'true';

		const iconElement = document.createElement('span');
		iconElement.classList.add(...ThemeIcon.asClassNameArray(icon));
		button.appendChild(iconElement);

		return button;
	}

	override focus(): void {
		this.viewportElement?.focus();
	}

	override layout(_dimension: Dimension): void {
		if (this.hasCenteredInitialViewport || !this.viewportElement || !this.surfaceElement) {
			return;
		}

		const { clientWidth, clientHeight } = this.viewportElement;
		if (!clientWidth || !clientHeight) {
			return;
		}

		this.viewportElement.scrollLeft = Math.max(0, Math.round((this.surfaceElement.scrollWidth - clientWidth) / 2));
		this.viewportElement.scrollTop = Math.max(0, Math.round((this.surfaceElement.scrollHeight - clientHeight) / 2));
		this.hasCenteredInitialViewport = true;
	}
}
