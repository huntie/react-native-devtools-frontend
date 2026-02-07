// Copyright (c) Meta Platforms, Inc. and affiliates.
// Copyright 2021 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/* eslint-disable rulesdir/check-license-header */

// ----------------------------------------------------------------------------
// Chrome DevTools Extensions API for React Native.
//
// This API spec forks ./ExtensionAPI.d.ts to provide a more limited API
// surface for React Native DevTools extensions.
// ----------------------------------------------------------------------------

export namespace Chrome {
  export namespace DevTools {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    export interface EventSink<ListenerT extends(...args: any) => void> {
      addListener(listener: ListenerT): void;
      removeListener(listener: ListenerT): void;
    }

    export interface Resource {
      readonly url: string;
      readonly type: string;

      getContent(callback: (content: string, encoding: string) => unknown): void;
      setContent(content: string, commit: boolean, callback?: (error?: Object) => unknown): void;
      /**
       * Augments this resource's scopes information based on the list of {@link NamedFunctionRange}s
       * for improved debuggability and function naming.
       *
       * @throws
       * If this resource was not produced by a sourcemap or if {@link ranges} are not nested properly.
       * Concretely: For each range, start position must be less than end position, and
       * there must be no "straddling" (i.e. partially overlapping ranges).
       */
      setFunctionRangesForScript(ranges: NamedFunctionRange[]): Promise<void>;
      attachSourceMapURL(sourceMapURL: string): Promise<void>;
    }

    export interface InspectedWindow {
      tabId: number;

      onResourceAdded: EventSink<(resource: Resource) => unknown>;
      onResourceContentCommitted: EventSink<(resource: Resource, content: string) => unknown>;

      eval(
          expression: string,
          options?: {scriptExecutionContext?: string, frameURL?: string, useContentScriptContext?: boolean},
          callback?: (result: unknown, exceptioninfo: {
            code: string,
            description: string,
            details: unknown[],
            isError: boolean,
            isException: boolean,
            value: string,
          }) => unknown): void;
      getResources(callback: (resources: Resource[]) => unknown): void;
      reload(reloadOptions?: {ignoreCache?: boolean, injectedScript?: string, userAgent?: string}): void;
    }

    export interface Button {
      onClicked: EventSink<() => unknown>;
      update(iconPath?: string, tooltipText?: string, disabled?: boolean): void;
    }

    export interface ExtensionView {
      onHidden: EventSink<() => unknown>;
      onShown: EventSink<(window?: Window) => unknown>;
    }

    export interface ExtensionPanel extends ExtensionView {
      show(): void;
      onSearch: EventSink<(action: string, queryString?: string) => unknown>;
      createStatusBarButton(iconPath: string, tooltipText: string, disabled: boolean): Button;
    }

    export interface Panels {
      themeName: string;

      create(title: string, iconPath: string, pagePath: string, callback?: (panel: ExtensionPanel) => unknown): void;

      /**
       * Fired when the theme changes in DevTools.
       *
       * @param callback The handler callback to register and be invoked on theme changes.
       */
      setThemeChangeHandler(callback?: (themeName: string) => unknown): void;
    }

    export interface Position {
      line: number;
      column: number;
    }

    export interface NamedFunctionRange {
      readonly name: string;
      readonly start: Position;
      readonly end: Position;
    }

    export interface DevToolsAPI {
      panels: Panels;
      inspectedWindow: InspectedWindow;
    }

    export interface Chrome {
      devtools: DevToolsAPI;
    }
  }
}

declare global {
  interface Window {
    chrome: Chrome.DevTools.Chrome;
  }
}
