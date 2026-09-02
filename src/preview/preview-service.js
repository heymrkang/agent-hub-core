import { getDb } from '../database/index.js';
import { REPOS_ROOT } from '../git/git-manager.js';
import { getSettingsManager } from '../settings/settings-manager.js';
import { PreviewManager } from './preview-manager.js';
import { PreviewRegistry } from './preview-registry.js';
import { PreviewRuntime } from './preview-runtime.js';
import { PreviewRuntimeDetector } from './runtime-detector.js';
import { PreviewCleanup } from './preview-cleanup.js';

let service = null;

export function getPreviewService() {
  if (service) return service;
  const settings = getSettingsManager();
  const registry = new PreviewRegistry({
    db: getDb(),
    maxActive: () => settings.get('preview_max_concurrent')
  });
  const runtime = new PreviewRuntime();
  const manager = new PreviewManager({ registry, runtime });
  service = {
    registry,
    manager,
    cleanup: new PreviewCleanup({
      registry,
      runtime,
      manager,
      idleTimeoutHours: () => settings.get('preview_idle_timeout_hours')
    }),
    detector: new PreviewRuntimeDetector({ developmentRoot: process.env.DEVELOPMENT_ROOT || REPOS_ROOT })
  };
  return service;
}

export function setPreviewServiceForTests(value) {
  service = value;
}
