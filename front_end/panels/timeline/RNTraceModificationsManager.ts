// Copyright (c) Meta Platforms, Inc. and affiliates.
// Copyright 2024 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import type * as Trace from '../../models/trace/trace.js';

import {ModificationsManager} from './ModificationsManager.js';

const LONG_TASK_THRESHOLD_MS = 1000;

/**
 * Manages React Native (RN)-specific trace modifications and annotations.
 * Analyzes events in the trace and applies annotations for specific patterns.
 */
export class RNTraceModificationsManager {
  #parsedTrace: Trace.Handlers.Types.ParsedTrace | null = null;

  constructor(parsedTrace: Trace.Handlers.Types.ParsedTrace) {
    this.#parsedTrace = parsedTrace;
  }

  /**
   * Apply RN-specific annotations to the trace by analyzing events.
   * Called after trace rendering (e.g. from TimelineFlameChartView).
   */
  applyTraceAnnotations(): void {
    if (!this.#parsedTrace || !ModificationsManager.activeManager()) {
      return; // Gracefully skip if no trace or manager is available
    }

    try {
      this.#annotateCascadingUpdates();
      this.#annotateLongTasks();
    } catch (error) {
      console.warn('Failed to apply RN trace annotations:', error);
    }
  }

  #annotateCascadingUpdates(): void {
    if (!this.#parsedTrace) {
      return;
    }

    const allEvents: Trace.Types.Events.Event[] =
      this.#parsedTrace.Renderer?.allTraceEntries || [];

    const cascadingUpdates = allEvents.filter(
      (event): event is Trace.Types.Events.Event =>
        event.name === 'Cascading Update'
    );
    cascadingUpdates.forEach(event => {
      ModificationsManager.activeManager()?.createAnnotation({
        type: 'ENTRY_LABEL',
        entry: event,
        label: '❌ Cascading Update',
      });
    });
  }

  #annotateLongTasks(): void {
    if (!this.#parsedTrace) {
      return;
    }

    const allEvents: Trace.Types.Events.Event[] =
      this.#parsedTrace.Renderer?.allTraceEntries || [];

    const longTasks = allEvents.filter(
      (event): event is Trace.Types.Events.Event => {
        const data = (
          event.args as {
            data?: { name?: string, start?: number, end?: number },
          }
        )?.data;
        if (
          data?.name !== 'longtask' ||
          typeof data.start !== 'number' ||
          typeof data.end !== 'number'
        ) {
          return false;
        }
        const durationMs = (data.end - data.start) / 1000;
        return durationMs >= LONG_TASK_THRESHOLD_MS;
      }
    );
    longTasks.forEach(event => {
      ModificationsManager.activeManager()?.createAnnotation({
        type: 'ENTRY_LABEL',
        entry: event,
        label: '⚠️ Long Task',
      });
    });
  }
}
