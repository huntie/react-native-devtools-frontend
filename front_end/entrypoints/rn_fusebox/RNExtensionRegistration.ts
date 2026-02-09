// Copyright (c) Meta Platforms, Inc. and affiliates.
// Copyright 2024 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as Host from '../../core/host/host.js';
import type * as Platform from '../../core/platform/platform.js';
import * as SDK from '../../core/sdk/sdk.js';

/**
 * Extension descriptor shape expected in `globalThis.__DEVTOOLS_EXTENSIONS__`.
 * This matches a subset of `Host.InspectorFrontendHostAPI.ExtensionDescriptor`
 * with `name` and `startPage` required. Other fields are populated with
 * defaults if omitted.
 */
interface RNExtensionConfig {
  name: string;
  startPage: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/naming-convention, no-var
  var __DEVTOOLS_EXTENSIONS__: RNExtensionConfig[] | undefined;

  interface Window {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    DevToolsAPI?: {
      getInspectedTabId?(): string | undefined,
      getOriginsForbiddenForExtensions?(): string[],
    } | undefined;
  }
}

/**
 * Namespaces to remove from the injected extension API script. These are
 * Chrome-only APIs not included in `ExtensionAPIReactNative.d.ts`.
 */
const DISALLOWED_API_NAMESPACES: string[] = [
  'chrome.devtools.network',
  'chrome.devtools.languageServices',
  'chrome.devtools.recorder',
  'chrome.devtools.performance',
  'chrome.experimental',
];

/**
 * Returns JavaScript source that wraps `chrome.devtools.panels.create` to
 * resolve relative resource paths against the extension's base directory.
 *
 * In Chrome, each extension has its own origin so relative paths resolve
 * naturally. In Fusebox, all extensions share the DevTools origin, so
 * `expandResourcePath` (which resolves against the bare origin) would
 * place resources at the wrong path.
 */
function buildPathResolutionScript(basePath: string): string {
  return `(function() {
  var _basePath = ${JSON.stringify(basePath)};
  function _resolve(p) {
    return (!p || p.startsWith('/') || p.startsWith('http:') || p.startsWith('https:')) ? p : _basePath + p;
  }
  var _origCreate = chrome.devtools.panels.create;
  chrome.devtools.panels.create = function(title, icon, page, callback) {
    return _origCreate.call(this, title, _resolve(icon), _resolve(page), callback);
  };
})();`;
}

/**
 * Returns JavaScript source that deletes disallowed API namespaces from the
 * extension's global scope.
 */
function buildAPICleanupScript(): string {
  return DISALLOWED_API_NAMESPACES.map(ns => `delete ${ns};`).join('\n');
}

/**
 * Sets up DevTools extension registration for the React Native Fusebox
 * entrypoint. This must be called **before** `new MainImpl()` so that the
 * host stub overrides are in place when `ExtensionServer` initialises.
 *
 * The mechanism:
 * 1. Reads extension descriptors from `globalThis.__DEVTOOLS_EXTENSIONS__`
 *    (populated by `extensionsConfig.js`, a sync script loaded before the
 *    entrypoint).
 * 2. Overrides `setInjectedScriptForOrigin` on the host stub to store
 *    injection scripts keyed by origin.
 * 3. Overrides `setAddExtensionCallback` on the host stub to capture the
 *    callback from `ExtensionServer.initializeExtensions()`, then immediately
 *    feeds each registered extension descriptor into it.
 * 4. Listens for `'requestExtensionAPI'` messages from extension iframes and
 *    responds with the stored injection script (with disallowed API namespaces
 *    removed).
 *
 * Extension iframes receive their API via this PostMessage handshake rather
 * than native injection, since Fusebox runs in a hosted (non-Chrome) context.
 */
export function setupRNExtensionRegistration(): void {
  const extensions: RNExtensionConfig[] = globalThis.__DEVTOOLS_EXTENSIONS__ ?? [];

  if (extensions.length === 0) {
    return;
  }

  const hostInstance = Host.InspectorFrontendHost.InspectorFrontendHostInstance;
  const injectedScripts = new Map<string, string>();
  const apiCleanupScript = buildAPICleanupScript();

  // Provide a synthetic inspected tab ID so that
  // ExtensionServer.initializeExtensions() proceeds. In Chrome, this comes
  // from the native embedder; in Fusebox there is no tab concept.
  window.DevToolsAPI = window.DevToolsAPI || {};
  window.DevToolsAPI.getInspectedTabId = (): string => 'react-native';

  // Override setInjectedScriptForOrigin to store injection scripts by origin
  // instead of the default no-op stub.
  hostInstance.setInjectedScriptForOrigin = (origin: string, script: string): void => {
    injectedScripts.set(origin, script);
  };

  // Override setAddExtensionCallback to intercept the callback from
  // ExtensionServer.initializeExtensions(). In Chrome, addExtension()
  // checks for a non-empty inspectedURL (a Chrome tab concept). In
  // Fusebox there is no inspected page initially, so addExtension()
  // defers to #pendingExtensions — which are only drained on
  // INSPECTED_URL_CHANGED, an event that may never fire. We work around
  // this by waiting for a primary page target to appear, then calling
  // addExtension via the captured callback.
  hostInstance.setAddExtensionCallback = (
    callback: (descriptor: Host.InspectorFrontendHostAPI.ExtensionDescriptor) => void,
  ): void => {
    const descriptors = extensions.map(ext => ({
      startPage: ext.startPage,
      name: ext.name,
      exposeExperimentalAPIs: false,
    } satisfies Host.InspectorFrontendHostAPI.ExtensionDescriptor));

    const addAllExtensions = (): void => {
      // addExtension() bails when inspectedURL is empty. In Fusebox,
      // the RN target has no web page URL. Set a synthetic URL so the
      // check passes and the extension registers normally.
      const target = SDK.TargetManager.TargetManager.instance().primaryPageTarget();
      if (target && !target.inspectedURL()) {
        target.setInspectedURL(window.location.origin as Platform.DevToolsPath.UrlString);
      }

      for (const descriptor of descriptors) {
        callback(descriptor);
      }
    };

    // If a primary page target already exists, register immediately.
    if (SDK.TargetManager.TargetManager.instance().primaryPageTarget()) {
      addAllExtensions();
      return;
    }

    // Otherwise, wait for a target to appear.
    const observer: SDK.TargetManager.Observer = {
      targetAdded(target: SDK.Target.Target): void {
        if (target === SDK.TargetManager.TargetManager.instance().primaryPageTarget()) {
          SDK.TargetManager.TargetManager.instance().unobserveTargets(observer);
          addAllExtensions();
        }
      },
      targetRemoved(_target: SDK.Target.Target): void {},
    };
    SDK.TargetManager.TargetManager.instance().observeTargets(observer);
  };

  // Listen for extension iframes requesting their API injection script.
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.data !== 'requestExtensionAPI') {
      return;
    }

    const sourceWindow = event.source as Window | null;
    if (!sourceWindow) {
      return;
    }

    // Determine the origin of the requesting iframe. Same-origin iframes
    // report their origin on the event; use window.location.origin as a
    // fallback since extensions are served from the same origin.
    const origin = event.origin || window.location.origin;
    const script = injectedScripts.get(origin);
    if (!script) {
      console.warn(
        '[RNExtensionRegistration] No injection script found for origin:',
        origin,
      );
      return;
    }

    // Find the extension iframe that sent this message so we can derive
    // its base directory for resolving relative resource paths.
    let basePath = '/';
    const iframes = document.querySelectorAll<HTMLIFrameElement>('iframe[data-devtools-extension]');
    for (const iframe of iframes) {
      if (iframe.contentWindow === sourceWindow) {
        const url = new URL(iframe.src, window.location.origin);
        basePath = url.pathname.substring(0, url.pathname.lastIndexOf('/') + 1);
        break;
      }
    }

    // Build the full script: invoke the injection IIFE with a unique ID,
    // patch relative path resolution, then clean up disallowed namespaces.
    const injectedScriptId = Date.now();
    const fullScript =
        `${script}(${injectedScriptId});\n${buildPathResolutionScript(basePath)}\n${apiCleanupScript}`;

    sourceWindow.postMessage(
      {type: 'extensionAPIInjection', script: fullScript},
      '*',
    );
  });
}
