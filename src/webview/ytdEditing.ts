import type { NewTextureImage } from '../shared/model';
import { isBlockFormat } from '../formats/bcEncode';
import { canvasToRgba, decodeImage, nearestPowerOfTwo, resizeCanvas } from './imageUtils';
import { hostRequest, newRequestId } from './ui';

/**
 * Adding, deleting and renaming textures in a .ytd. The extension host asks
 * for confirmation and writes the file; the view then reloads on its own.
 */

/** Largest side of an added texture. */
const MAX_SIZE = 8192;

/** Picks images and adds them to the .ytd at `origin`, reporting progress through `say`. */
export async function addTexturesFromFiles(origin: string, say: (text: string) => void): Promise<void> {
  const picked = await hostRequest({ type: 'pickImages', requestId: newRequestId() }, 'pickedImages');
  if (!picked.files.length) return;
  say(`Loading ${picked.files.length === 1 ? picked.files[0].name : `${picked.files.length} images`}…`);
  const textures: NewTextureImage[] = [];
  const failed: string[] = [];
  for (const file of picked.files) {
    try {
      textures.push(await newTexture(file.name, file.data));
    } catch (err) {
      failed.push(`${file.name}: ${(err as Error).message}`);
    }
  }
  if (!textures.length) return say(`Couldn't load ${failed.join('; ')}`);
  say('Encoding and saving…');
  const reply = await hostRequest({ type: 'addTextures', requestId: newRequestId(), origin, textures }, 'ytdEdited');
  const skipped = failed.length ? ` Skipped ${failed.join('; ')}.` : '';
  say(resultText(reply) + skipped);
}

/** Deletes textures from the .ytd at `origin`; without `names`, the user picks them. */
export async function deleteTexturesFrom(origin: string, names?: string[]): Promise<{ ok: boolean; text: string }> {
  const reply = await hostRequest({ type: 'deleteTextures', requestId: newRequestId(), origin, names }, 'ytdEdited');
  return { ok: reply.ok, text: resultText(reply) };
}

/** Renames a texture in the .ytd at `origin` (the host asks for the new name). */
export async function renameTextureIn(origin: string, name: string): Promise<{ ok: boolean; text: string }> {
  const reply = await hostRequest({ type: 'renameTexture', requestId: newRequestId(), origin, name }, 'ytdEdited');
  return { ok: reply.ok, text: resultText(reply) };
}

/** Status text for a reply: only failures (VS Code reports successes, and the view reloads). */
function resultText(reply: { ok: boolean; cancelled?: boolean; error?: string }): string {
  return reply.ok || reply.cancelled ? '' : `Failed: ${reply.error}`;
}

/**
 * A texture from an image file, named after the file. A .dds keeps its own
 * format, size and mips; other images become DXT5 (DXT1 when fully opaque)
 * with a full mip chain, resized to the nearest power of two (which the game
 * and mipmaps work best with).
 * Size and format can be changed afterwards from the texture viewer.
 */
async function newTexture(fileName: string, data: Uint8Array): Promise<NewTextureImage> {
  const name = fileName.replace(/\.[^.]+$/, '');
  const image = await decodeImage(fileName, data);
  const dds = image.dds;
  if (dds && !(isBlockFormat(dds.format) && (dds.width % 4 || dds.height % 4))) {
    return { name, width: dds.width, height: dds.height, format: dds.format, levels: dds.levels, encoded: dds.allLevels };
  }
  const side = (n: number) => Math.min(MAX_SIZE, Math.max(4, nearestPowerOfTwo(n)));
  const width = side(image.canvas.width);
  const height = side(image.canvas.height);
  const rgba = canvasToRgba(resizeCanvas(image.canvas, width, height));
  let opaque = true;
  for (let i = 3; i < rgba.length && opaque; i += 4) opaque = rgba[i] === 255;
  return { name, width, height, format: opaque ? 'DXT1' : 'DXT5', rgba };
}
