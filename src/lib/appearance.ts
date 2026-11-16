function channelLuminance(value: number): number {
  const channel = value / 255;
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const red = Number.parseInt(hex.slice(1, 3), 16);
  const green = Number.parseInt(hex.slice(3, 5), 16);
  const blue = Number.parseInt(hex.slice(5, 7), 16);
  return 0.2126 * channelLuminance(red) + 0.7152 * channelLuminance(green) + 0.0722 * channelLuminance(blue);
}

function contrast(first: string, second: string): number {
  const firstLuminance = luminance(first);
  const secondLuminance = luminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05) / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

export function readableTextColor(backgroundColor: string, manualColor: string, adaptive: boolean): string {
  if (!adaptive) return manualColor;
  const light = '#f4f7f5';
  const dark = '#17252c';
  return contrast(backgroundColor, light) >= contrast(backgroundColor, dark) ? light : dark;
}

export function taskFontSize(count: number, baseSize: number, minSize: number, scrollThreshold: number): number {
  const visibleCount = Math.min(Math.max(1, count), Math.max(1, scrollThreshold));
  const size = baseSize - Math.max(0, visibleCount - 1) * 0.65;
  return Math.round(Math.max(minSize, size) * 10) / 10;
}
