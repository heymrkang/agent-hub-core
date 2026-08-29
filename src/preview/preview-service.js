import { getDb } from '../database/index.js';
import { getSettingsManager } from '../settings/settings-manager.js';
import { PreviewManager } from './preview-manager.js';
import { PreviewRegistry } from './preview-registry.js';
import { PreviewRuntime } from './preview-runtime.js';
import { PreviewRuntimeDetector } from './runtime-detector.js';

let service = null;

export function getPreviewService() {
  if (service) return service;
  const settings = getSettingsManager();
  const registry = new PreviewRegistry({
    db: getDb(),
    maxActive: () => settings.get('preview_max_concurrent')
  });
  const runtime = new PreviewRuntime();
  service = {
    registry,
    manager: new PreviewManager({ registry, runtime }),
    detector: new PreviewRuntimeDetector({ developmentRoot: process.env.DEVELOPMENT_ROOT || '/home/dev' })
  };
  return service;
}

export function setPreviewServiceForTests(value) {
  service = value;
}
