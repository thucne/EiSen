import { en } from './en';
import { vi } from './vi';

export type Locale = 'en' | 'vi';

export const locales: Locale[] = ['en', 'vi'];
export const defaultLocale: Locale = 'en';

/** Cloudflare Pages `_redirects` maps this to the GitHub Release asset. */
export const dmgDownloadPath = '/download';

export function getDictionary(locale?: string) {
  if (locale === 'vi') return vi;
  return en;
}

export function getLocalizedPath(currentPath: string, targetLocale: Locale): string {
  // Clean trailing slashes
  const path = currentPath.replace(/\/$/, '') || '/';
  
  if (targetLocale === 'en') {
    if (path.startsWith('/vi')) {
      const remaining = path.replace(/^\/vi/, '') || '/';
      return remaining;
    }
    return path;
  }

  if (targetLocale === 'vi') {
    if (path.startsWith('/vi')) {
      return path;
    }
    return path === '/' ? '/vi' : `/vi${path}`;
  }

  return path;
}
