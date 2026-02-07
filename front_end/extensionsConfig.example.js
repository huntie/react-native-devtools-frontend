// Copyright (c) Meta Platforms, Inc. and affiliates.
// Copyright 2024 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * React Native DevTools Extensions Configuration (example)
 *
 * `extensionsConfig.js` is loaded synchronously before the DevTools
 * entrypoint via a <script defer> tag in the HTML template. It declares
 * extensions that should be loaded into the React Native DevTools frontend.
 *
 * To use: This file is served dynamically from `@react-native/dev-middleware`.
 * Embedders can configure extensions as part of the options to
 * `createDevMiddleware()`.
 *
 * Each extension entry requires:
 *   - name:      Display name shown in the DevTools tab bar.
 *   - startPage: URL to the extension's start page (devtools.html). This page
 *                must include a bootstrap snippet to receive the extension API
 *                via PostMessage — see below.
 *
 * Extension start page bootstrap:
 *   <script>
 *     window.addEventListener('message', function onAPI(event) {
 *       if (event.data?.type === 'extensionAPIInjection') {
 *         window.removeEventListener('message', onAPI);
 *         (0, eval)(event.data.script);
 *         // chrome.devtools.panels and chrome.devtools.inspectedWindow are
 *         // now available.
 *         main();
 *       }
 *     });
 *     window.parent.postMessage('requestExtensionAPI', '*');
 *
 *     function main() {
 *       chrome.devtools.panels.create('My Panel', '', 'panel.html');
 *     }
 *   </script>
 */

globalThis.__DEVTOOLS_EXTENSIONS__ = [
  {
    name: 'My Extension',
    startPage: '/extensions/my-extension/devtools.html',
  },
];
