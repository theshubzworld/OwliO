import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { SupportedStorage } from '@supabase/supabase-js';
export interface CredentialEncryption {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}
export class SecureSessionStorage implements SupportedStorage {
  constructor(
    private file: string,
    private encryption: CredentialEncryption
  ) {}
  private read(): Record<string, string> {
    if (!fs.existsSync(this.file)) return {};
    if (!this.encryption.isEncryptionAvailable())
      throw Error('Windows credential encryption is unavailable.');
    const values = JSON.parse(
      this.encryption.decryptString(fs.readFileSync(this.file))
    );
    if (
      !values ||
      typeof values !== 'object' ||
      Array.isArray(values) ||
      Object.values(values).some((value) => typeof value !== 'string')
    )
      throw Error('Saved account session could not be read.');
    return values;
  }
  getItem(key: string): string | null {
    return this.read()[key] ?? null;
  }
  setItem(key: string, value: string): void {
    this.write({ ...this.read(), [key]: value });
  }
  removeItem(key: string): void {
    const values = this.read();
    delete values[key];
    this.write(values);
  }
  clear(): void {
    if (fs.existsSync(this.file)) fs.unlinkSync(this.file);
  }
  private write(values: Record<string, string>): void {
    if (!this.encryption.isEncryptionAvailable())
      throw Error('Windows credential encryption is unavailable.');
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = this.file + '.' + randomUUID() + '.tmp';
    try {
      fs.writeFileSync(
        temporary,
        this.encryption.encryptString(JSON.stringify(values)),
        { mode: 0o600 }
      );
      fs.renameSync(temporary, this.file);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
}
