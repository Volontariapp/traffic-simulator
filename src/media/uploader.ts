import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export class MediaUploader {
  private readonly cacheDir: string;
  private isStorageAvailable = true;

  constructor(private readonly gatewayUrl: string) {
    this.cacheDir = join(tmpdir(), 'volontariapp-traffic-simulator-images');
    try {
      if (!existsSync(this.cacheDir)) {
        mkdirSync(this.cacheDir, { recursive: true });
      }
    } catch {
      // Ignorer si déjà existant
    }
  }

  /**
   * Téléverse une photo vers MinIO via l'API Gateway et renvoie son fileId UUID.
   */
  async uploadImage(
    imageUrl: string,
    entityType: 'ENTITY_TYPE_EVENT_COVER' | 'ENTITY_TYPE_POST',
    accessToken: string,
  ): Promise<string | undefined> {
    if (!this.isStorageAvailable) {
      return undefined;
    }

    try {
      const buffer = await this.getImageBuffer(imageUrl);

      // 1. Déclarer le fichier et obtenir l'URL présignée MinIO
      const uploadUrlRes = await fetch(`${this.gatewayUrl}/storage/upload-url`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          entityType,
          mimeType: 'image/jpeg',
          sizeBytes: buffer.length,
          isPublic: true,
        }),
      });

      if (!uploadUrlRes.ok) {
        if (uploadUrlRes.status === 503) {
          this.isStorageAvailable = false;
        }
        return undefined;
      }

      const uploadData = (await uploadUrlRes.json()) as {
        fileId: string;
        uploadUrl: string;
        uploadFields: Record<string, string>;
      };

      if (!uploadData.fileId || !uploadData.uploadUrl) {
        return undefined;
      }

      // 2. Poster le binaire vers MinIO / S3 via multipart POST
      const formData = new FormData();
      for (const [key, value] of Object.entries(uploadData.uploadFields)) {
        formData.append(key, value);
      }
      formData.append(
        'file',
        new Blob([buffer], { type: 'image/jpeg' }),
        `${uploadData.fileId}.jpg`,
      );

      const s3Res = await fetch(uploadData.uploadUrl, {
        method: 'POST',
        body: formData,
      });

      if (!s3Res.ok && s3Res.status !== 204) {
        return undefined;
      }

      // 3. Confirmer l'upload auprès de l'API Gateway
      const confirmRes = await fetch(
        `${this.gatewayUrl}/storage/files/${uploadData.fileId}/confirm`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      if (!confirmRes.ok) {
        return undefined;
      }

      return uploadData.fileId;
    } catch {
      return undefined;
    }
  }

  private async getImageBuffer(imageUrl: string): Promise<Buffer> {
    const hash = createHash('md5').update(imageUrl).digest('hex');
    const cacheFile = join(this.cacheDir, `${hash}.jpg`);

    if (existsSync(cacheFile)) {
      try {
        return readFileSync(cacheFile);
      } catch {
        // En cas d'erreur de lecture de cache, continuer
      }
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 7000);
      const res = await fetch(imageUrl, { signal: controller.signal });
      clearTimeout(timeout);

      if (res.ok) {
        const arrayBuf = await res.arrayBuffer();
        const buf = Buffer.from(arrayBuf);
        try {
          writeFileSync(cacheFile, buf);
        } catch {
          // Ignorer
        }
        return buf;
      }
    } catch {
      // Échec réseau -> fallback procédural
    }

    const fallback = this.generateFallbackJpeg();
    try {
      writeFileSync(cacheFile, fallback);
    } catch {
      // Ignorer
    }
    return fallback;
  }

  private generateFallbackJpeg(): Buffer {
    return Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00,
      0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06,
      0x05, 0x08, 0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b,
      0x0c, 0x19, 0x12, 0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
      0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31,
      0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff,
      0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00,
      0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b,
      0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0xbf, 0x00, 0xff, 0xd9,
    ]);
  }
}

