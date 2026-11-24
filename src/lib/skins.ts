import type { ImageSkin } from '../types';

export const SKIN_OPTIONS = [
  { value: 'none', label: '透明日历' },
  { value: 'coast', label: '镰仓晚霞' },
  { value: 'earth', label: '蓝色弹珠' },
  { value: 'local', label: '本机图片' },
] as const;

const images = {
  coast: new URL('../assets/skins/coast.jpg', import.meta.url).href,
  earth: new URL('../assets/skins/earth.jpg', import.meta.url).href,
};

const localKey = 'floating-agenda-theme-image';

export function skinImage(skin: ImageSkin, local: string | null): string | null {
  if (skin === 'none') return null;
  return skin === 'local' ? local : images[skin];
}

export function readLocalSkin(): Promise<string | null> {
  if (window.desktop) return window.desktop.loadThemeImage();
  return Promise.resolve(localStorage.getItem(localKey));
}

export async function importLocalSkin(file: File): Promise<string> {
  if (!file.size || file.size > 24 * 1024 * 1024) throw new Error('请选择不超过 24 MB 的图片');
  const image = await createImageBitmap(file).catch(() => { throw new Error('无法读取图片，请选择 JPG、PNG 或 WebP'); });
  const canvas = document.createElement('canvas');
  try {
    const scale = Math.min(1, 1920 / Math.max(image.width, image.height));
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('无法处理图片');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
  } finally {
    image.close();
  }
  if (window.desktop) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
    if (!blob) throw new Error('无法保存图片');
    return window.desktop.saveThemeImage(new Uint8Array(await blob.arrayBuffer()));
  }
  const url = canvas.toDataURL('image/jpeg', 0.86);
  localStorage.setItem(localKey, url);
  return url;
}
