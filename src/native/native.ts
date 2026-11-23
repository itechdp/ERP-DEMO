// Things a browser does by itself but the Android app (a WebView) does not: downloading a file, opening a PDF link, printing.
// Every function works in both places: in the browser it does what the page always did, in the app it uses the phone's own way.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

/** the small Android plugin in android/app/src/main/java/.../NativePrintPlugin.java: opens the phone's print dialog ("Save as PDF" is in it) */
interface NativePrintPlugin {
  printHtml(o: { title: string; html: string }): Promise<void>;
  printPage(o: { title: string }): Promise<void>;
}
const NativePrint = registerPlugin<NativePrintPlugin>('NativePrint');

export const isNative = () => Capacitor.isNativePlatform();

/** open a link (a signed PDF / attachment link): a new tab in the browser, the phone's browser in the app */
export async function openUrl(url: string): Promise<void> {
  if (isNative()) await Browser.open({ url });
  else window.open(url, '_blank', 'noopener');
}

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

/** a file name that is safe on every system: document numbers like EAF/2026-0001 contain "/", which would mean a folder */
export const safeFileName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, '-');

/** save a file: a normal download in the browser; in the app it is written to the phone and the share sheet opens (Save to Drive / WhatsApp / Open with…) */
export async function saveFile(name: string, blob: Blob): Promise<void> {
  const filename = safeFileName(name);
  if (!isNative()) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  const written = await Filesystem.writeFile({ path: filename, data: await toBase64(blob), directory: Directory.Cache });
  await Share.share({ title: filename, dialogTitle: filename, url: written.uri });
}

/** images the page refers to by address (the logo) are put into the HTML itself, because the print view cannot reach the app's files */
async function inlineImages(html: string): Promise<string> {
  const urls = [...new Set([...html.matchAll(/(?:src|href)="(\/[^"]+\.(?:png|jpe?g|gif|svg|webp))"/gi)].map((m) => m[1]))];
  let out = html;
  for (const u of urls) {
    try {
      const blob = await (await fetch(u)).blob();
      const data = `data:${blob.type || 'image/png'};base64,${await toBase64(blob)}`;
      out = out.split(`"${u}"`).join(`"${data}"`);
    } catch {
      /* a missing picture should not stop the print */
    }
  }
  return out;
}

/** print a finished HTML document (title, css and body already in it) */
export async function printDocument(title: string, html: string): Promise<void> {
  await NativePrint.printHtml({ title, html: await inlineImages(html) });
}

/** print the page that is on screen (what window.print() does in a browser) */
export async function printPage(title = document.title || 'ForgeFlow ERP'): Promise<void> {
  if (isNative()) await NativePrint.printPage({ title });
  else window.print();
}
