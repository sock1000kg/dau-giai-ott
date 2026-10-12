import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export interface ObjectStorage { put(key: string, value: Uint8Array): Promise<void>; get(key: string): Promise<Uint8Array>; copy(source: string, destination: string): Promise<void>; remove(key: string): Promise<void>; }
export interface S3StorageOptions { readonly bucket: string; readonly client: S3Client; }

export function createS3Storage(options: S3StorageOptions): ObjectStorage {
  const copySource = (key: string) => `${options.bucket}/${encodeURIComponent(key).replace(/%2F/g, '/')}`;
  return {
    async put(key, value) { await options.client.send(new PutObjectCommand({ Bucket: options.bucket, Key: key, Body: value })); },
    async get(key) { const response = await options.client.send(new GetObjectCommand({ Bucket: options.bucket, Key: key })); if (response.Body === undefined) throw new Error('Object body is missing'); return response.Body.transformToByteArray(); },
    async copy(source, destination) { await options.client.send(new CopyObjectCommand({ Bucket: options.bucket, CopySource: copySource(source), Key: destination })); },
    async remove(key) { await options.client.send(new DeleteObjectCommand({ Bucket: options.bucket, Key: key })); },
  };
}
