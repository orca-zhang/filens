import { DEFAULT_FORMAT_ROUTES, normalizeExtension } from './formats';
import type { PreviewDriver, PreviewFamily } from './types';

/** Share an in-flight import, retaining the real session's complete control API. */
export function createLazyPreviewDriver(
  id: string,
  family: PreviewFamily,
  loader: () => Promise<PreviewDriver>,
  supports = (format: string) => DEFAULT_FORMAT_ROUTES.some(route =>
    route.driverId === id && route.extensions.includes(normalizeExtension(format)))
): PreviewDriver {
  let loaded: PreviewDriver | undefined;
  let pending: Promise<PreviewDriver> | undefined;
  return {
    id, family,
    supports: format => loaded ? loaded.supports(format) : supports(format),
    loadDriver() {
      return pending ??= Promise.resolve().then(loader).then(driver => {
        if (driver.id !== id || driver.loadDriver) throw new Error(`Invalid lazy preview driver: ${id}.`);
        loaded = driver;
        return driver;
      }).catch(error => {
        pending = undefined;
        throw error;
      });
    },
    createSession(host, options) {
      if (!loaded) throw new Error(`Preview driver ${id} must be loaded before creating a session.`);
      return loaded.createSession(host, options);
    }
  };
}

/** The previewer fallback must not statically import the PowerPoint renderer. */
export function createLazyCorePreviewDrivers(): PreviewDriver[] {
  return [
    createLazyPreviewDriver('pptx', 'paged', () => import('./pptx-driver').then(({ createPptxPreviewDriver }) => createPptxPreviewDriver())),
    ...(['image', 'text', 'html', 'media'] as const).map(id => createLazyPreviewDriver(
      id, id === 'media' ? 'video' : id,
      () => import('./native-drivers').then(({ createDefaultNativePreviewDrivers }) =>
        createDefaultNativePreviewDrivers().find(driver => driver.id === id)!)
    ))
  ];
}
