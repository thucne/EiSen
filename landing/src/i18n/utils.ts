import { en } from './en';
import { vi } from './vi';

export type Locale = 'en' | 'vi';

export const locales: Locale[] = ['en', 'vi'];
export const defaultLocale: Locale = 'en';

export const appVersion = '0.2.6';

/** Cloudflare Pages `_redirects` maps these to GitHub Release assets. */
export const dmgDownloadPath = '/download/mac';
export const exeDownloadPath = '/download/windows';
export const microsoftStoreUrl = 'https://apps.microsoft.com/detail/9NRLQNXFVBF8';
export const releasesUrl = 'https://github.com/thucne/EiSen/releases';
export const githubUrl = 'https://github.com/thucne/EiSen';

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
